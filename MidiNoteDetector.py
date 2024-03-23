import time
import argparse
from multiprocessing import Process

import mido
import librosa

from EventMonitor import EventMonitor
from NoteUtils import NoteData, note_data_from_midi_name

class MidiNoteDetector(Process):

  def __init__(self, event_monitor: EventMonitor, args: argparse.Namespace):
    super(MidiNoteDetector, self).__init__()
    self.event_monitor = event_monitor
    self.args = args
    self.midi_port = None
    self.active_notes = {}

  def _clean_up_midi_port(self, disconnected=False):
    if self.midi_port is not None:
      self.midi_port.close()
      del self.midi_port
      if disconnected:
        self.event_monitor.on_event(
          EventMonitor.EVENT_ISSUER_MIDI,
          EventMonitor.EVENT_TYPE_DISCONNECTED,
        )
    self.midi_port = None

  @staticmethod
  def _print_midi_message(midi):
    if midi.isNoteOn():
      print('ON: ', midi.getMidiNoteName(midi.getNoteNumber()), midi.getVelocity())
    elif midi.isNoteOff():
      print('OFF:', midi.getMidiNoteName(midi.getNoteNumber()))
    elif midi.isController():
      print('CONTROLLER', midi.getControllerNumber(), midi.getControllerValue())

  def _update_active_notes(self, midi):
    MIN_VELOCITY = 5.0
    SATURATION_VELOCITY = 32.0

    if midi.type == 'note_on':
      midi_note_name = librosa.midi_to_note(midi.note, octave=True, unicode=False)
      if midi.velocity >= MIN_VELOCITY:
        note_name, note_octave = note_data_from_midi_name(midi_note_name)
        self.active_notes[midi_note_name] = NoteData(
          issuers={EventMonitor.EVENT_ISSUER_MIDI},
          note_name=note_name,
          note_octave=note_octave,
          intensity=max(0.0, min(1.0, midi.velocity / SATURATION_VELOCITY))
        )
        self.event_monitor.on_event(
          EventMonitor.EVENT_ISSUER_MIDI,
          EventMonitor.EVENT_TYPE_NOTE_ON,
          self.active_notes[midi_note_name]
        )
      else:
        if midi_note_name in self.active_notes:
          self.event_monitor.on_event(
            EventMonitor.EVENT_ISSUER_MIDI,
            EventMonitor.EVENT_TYPE_NOTE_OFF,
            self.active_notes[midi_note_name]
          )
          self.active_notes.pop(midi_note_name, None)

    elif midi.type == 'note_off':
      midi_note_name = librosa.midi_to_note(midi.note, octave=True, unicode=False)
      if midi_note_name in self.active_notes:
        self.event_monitor.on_event(
          EventMonitor.EVENT_ISSUER_MIDI,
          EventMonitor.EVENT_TYPE_NOTE_OFF,
          self.active_notes[midi_note_name]
        )
        self.active_notes.pop(midi_note_name, None)

  def run(self):
    MIDI_PORT_CHECK_TIME_S = 5.0
    INIT_SLEEP_TIME_S = 1
    MAX_SLEEP_TIME_S = 16

    try:
      midi_ports = []
      find_midi_wait_time_s = INIT_SLEEP_TIME_S
      while True:
        midi_ports = mido.get_input_names()
        if len(midi_ports) == 0:
          if find_midi_wait_time_s == INIT_SLEEP_TIME_S:
            print("No MIDI ports found. Sleeping for a bit then retrying...")
          time.sleep(find_midi_wait_time_s)
          find_midi_wait_time_s = min(2*find_midi_wait_time_s, MAX_SLEEP_TIME_S)
          continue
        else:
          find_midi_wait_time_s = INIT_SLEEP_TIME_S

        port_name = midi_ports[0]
        self.midi_port = mido.open_input(port_name)
        print('Opened MIDI port:', port_name)
        self.event_monitor.on_event(
          EventMonitor.EVENT_ISSUER_MIDI,
          EventMonitor.EVENT_TYPE_CONNECTED,
        )

        last_time = time.time()
        last_port_check_time = last_time
        self.active_notes = {}

        while True:
          current_time = time.time()
          for msg in self.midi_port.iter_pending():
            self._update_active_notes(msg)
            #self._print_midi_message(m)

          # Every so often we should check to see if the midi ports have changed,
          # Unfortunately, the RtMidi library doesn't provide a way to check if the
          # port list has changed or if the device has disconnected,
          # so we have to do it manually.
          if current_time - last_port_check_time >= MIDI_PORT_CHECK_TIME_S:
            curr_midi_ports = mido.get_input_names()
            if len(curr_midi_ports) == 0:
              self._clean_up_midi_port(disconnected=True)
              midi_ports = []
              print('No MIDI ports found, retrying...')
              break
            else:
              midi_ports = curr_midi_ports
    except KeyboardInterrupt:
      # For Ctrl+C to work cleanly
      print("MidiNoteDetector terminated. Exiting...")