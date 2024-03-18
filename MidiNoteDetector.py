
from threading import Thread
import rtmidi
import time

from EventMonitor import EventMonitor
from NoteUtils import note_data_from_midi_name, standardize_note_name

class MidiNoteDetector(Thread):

  def __init__(self, event_monitor: EventMonitor):
    super(MidiNoteDetector, self).__init__()
    self.event_monitor = event_monitor
    self.midiin = None
    self.active_notes = {}
    self._init_midi()

  def _init_midi(self):
    if self.midiin is not None:
      del self.midiin
      self.event_monitor.on_event(
        EventMonitor.EVENT_ISSUER_MIDI, 
        EventMonitor.EVENT_TYPE_DISCONNECTED, 
      )
    self.midiin = rtmidi.RtMidiIn()

  @staticmethod
  def _print_midi_message(midi):
    if midi.isNoteOn():
      print('ON: ', midi.getMidiNoteName(midi.getNoteNumber()), midi.getVelocity())
    elif midi.isNoteOff():
      print('OFF:', midi.getMidiNoteName(midi.getNoteNumber()))
    elif midi.isController():
      print('CONTROLLER', midi.getControllerNumber(), midi.getControllerValue())

  def _find_midi_ports(self, blocking=True):
    ports = []
    while (len(ports) == 0):
      ports = range(self.midiin.getPortCount())
      if len(ports) == 0 and blocking:
        time.sleep(1)
      else:
        break
    return ports
  
  def _update_active_notes(self, midi):
    MIN_VELOCITY = 5.0
    SATURATION_VELOCITY = 32.0

    if midi.isNoteOn():
      midi_note_name = midi.getMidiNoteName(midi.getNoteNumber())
      if midi.getVelocity() >= MIN_VELOCITY:
        note_name, note_octave = note_data_from_midi_name(midi_note_name)
        note_name = standardize_note_name(note_name)
        self.active_notes[midi_note_name] = {
          'note_name': note_name,
          'note_octave': note_octave,
          'intensity': max(0.0, min(1.0, midi.getVelocity() / SATURATION_VELOCITY))
        }
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

    elif midi.isNoteOff():
      midi_note_name = midi.getMidiNoteName(midi.getNoteNumber())
      if midi_note_name in self.active_notes:
        self.event_monitor.on_event(
          EventMonitor.EVENT_ISSUER_MIDI, 
          EventMonitor.EVENT_TYPE_NOTE_OFF, 
          self.active_notes[midi_note_name]
        )
        self.active_notes.pop(midi_note_name, None)

  def run(self):
    MIDI_PORT_CHECK_TIME_S = 5.0
    MIDI_GET_MSG_TIMEOUT_MS = 250

    midi_ports = []
    while True:
      if len(midi_ports) == 0:
        midi_ports = self._find_midi_ports()
      else:
        assert len(midi_ports) > 0
        open_port = midi_ports[0]
        self.midiin.openPort(open_port)
        print('OPENED MIDI PORT:', self.midiin.getPortName(open_port))
        self.event_monitor.on_event(
          EventMonitor.EVENT_ISSUER_MIDI, 
          EventMonitor.EVENT_TYPE_CONNECTED, 
        )

        last_time = time.time()
        last_port_check_time = last_time
        self.active_notes = {}

        while True:
          current_time = time.time()
          dt = current_time - last_time
          last_time = current_time
          m = self.midiin.getMessage(MIDI_GET_MSG_TIMEOUT_MS)
          if m:
            self._update_active_notes(m)
            #self._print_midi_message(m)

          # Every so often we should check to see if the midi ports have changed,
          # Unfortunately, the RtMidi library doesn't provide a way to check if the
          # port list has changed or if the device has disconnected, 
          # so we have to do it manually.
          if current_time - last_port_check_time >= MIDI_PORT_CHECK_TIME_S:
            curr_midi_ports = self._find_midi_ports(blocking=False)
            if len(curr_midi_ports) == 0:
              self._init_midi()
              midi_ports = []
              print('NO MIDI PORTS FOUND, RETRYING...')
              break
            else:
              midi_ports = curr_midi_ports
