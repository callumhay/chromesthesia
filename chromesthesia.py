import time
import math
import argparse
from multiprocessing import Process
from typing import Dict

import numpy as np

from EventMonitor import EventMonitor
from MicNoteDetector import MicNoteDetector
from MidiNoteDetector import MidiNoteDetector
from Animation import Animation, sqrtstep
from NoteUtils import NoteData, midi_name_from_note_data, note_to_rgb

class Animator(Process):
  DEFAULT_ANIM_FADE_IN_TIME_S  = 0.05
  DEFAULT_ANIM_FADE_OUT_TIME_S = 0.01

  def __init__(self, event_monitor: EventMonitor, args: argparse.Namespace):
    super(Animator, self).__init__()
    self.args = args
    self.is_midi_connected = False
    self.is_mic_connected = False
    # Currently active notes, also tracks the set of inputs the notes came from
    # so we can smartly process note on/off events.
    self.active_notes: Dict[str, NoteData] = {}
    # Currently active colour animations - these are the animations that are
    # currently contributing to the total colour of the LEDs. They are mapped
    # to the midi note name that they are animating.
    self.active_animations: Dict[str, Animation] = {}
    self.prev_total_colour = np.array([math.nan, math.nan, math.nan]) # Debug purposes only
    self.event_monitor = event_monitor
    self.register_callbacks()

  def run(self):
    try:
      last_time = time.time()
      while True:
        # NO BLOCKING HERE: We need animations to continue updating
        # even if there are no events to process
        self.event_monitor.process_events()

        # Update the colour of the LEDs via the active animations
        current_time = time.time()
        dt = current_time - last_time
        self.update_colour(dt)
        last_time = current_time
    except KeyboardInterrupt:
      # For Ctrl+C to work cleanly
      print("Animator terminated. Exiting...")

  def update_colour(self, dt):
    animated_notes = set()
    total_colour = np.array([0.,0.,0.])
    for midi_note_name, anim in list(self.active_animations.items()):
      total_colour += anim.update(dt)
      # If the animation is done and no longer contributes colour then we remove it
      if anim.is_done() and np.array_equal(anim.curr_value, np.array([0.,0.,0.])):
        del self.active_animations[midi_note_name]
      else:
        animated_notes.add(midi_note_name)
    
    np.clip(total_colour, 0.0, 1.0, out=total_colour)

    if self.args.debug:
      if not np.array_equal(self.prev_total_colour, total_colour):
        print(", ".join(animated_notes), total_colour)
    self.prev_total_colour = total_colour

    # TODO: Set the LEDs to the total_colour
    #pixels.fill((int(total_colour[0]*255), int(total_colour[1]*255), int(total_colour[2]*255)))
    
  def note_on_animation(self, midi_note_name: str, note_data: NoteData):
    note_colour = note_to_rgb(note_data.note_name, note_data.intensity)
    if midi_note_name not in self.active_animations:
      self.active_animations[midi_note_name] = Animation(
        np.array([0.,0.,0.]), 
        note_colour,  
        Animator.DEFAULT_ANIM_FADE_IN_TIME_S,
        sqrtstep
      )
    else:
      curr_anim = self.active_animations[midi_note_name]
      # TODO: Consider using the distance between the two colours to determine the duration
      curr_anim.reset(
        curr_anim.curr_value,
        note_colour,
        Animator.DEFAULT_ANIM_FADE_IN_TIME_S, 
      )
    
  def note_off_animation(self, midi_note_name: str):
    if midi_note_name in self.active_animations:
      # Fade out the note
      note_anim = self.active_animations[midi_note_name]
      note_anim.reset(
        note_anim.curr_value,
        np.array([0.,0.,0.]),
        Animator.DEFAULT_ANIM_FADE_OUT_TIME_S,
        sqrtstep
      )

  def on_disconnect_remove_notes(self, issuer: str):
    notes_to_remove = []
    for k,v in self.active_notes.items():
      if v.issuers.difference({issuer}) == set():
        notes_to_remove.append(k)
      else:
        v.issuers.discard(issuer)
    for k in notes_to_remove:
      del self.active_notes[k]
      self.note_off_animation(k)

  def remove_active_note(self, midi_note_name: str, issuer: str):
    note_data = self.active_notes.get(midi_note_name, None)
    if note_data is not None:
      note_data.issuers.discard(issuer)
      if len(note_data.issuers) == 0:
        del self.active_notes[midi_note_name]
        self.note_off_animation(midi_note_name)

  # The main thread will run the event monitor and the note detectors
  # in separate threads. The note detectors will interact with each other
  # through the event monitor which calls the following callback 
  # functions in the Animator:
  
  # ****** START OF CALLBACK FUNCTIONS ******
  def on_midi_connected(self):
    print("MIDI connected.")
    self.is_midi_connected = True

  def on_midi_disconnected(self):
    print("MIDI disconnected.")
    self.is_midi_connected = False
    # Remove midi-only active notes
    self.on_disconnect_remove_notes(EventMonitor.EVENT_ISSUER_MIDI)

  def on_midi_note_on(self, note_data: NoteData):
    if self.args.debug:
      print("MIDI note on: ", note_data)
    midi_note_name = midi_name_from_note_data(note_data)
    self.note_on_animation(midi_note_name, note_data)
    active_note = self.active_notes.get(midi_note_name, None)
    if active_note is None:
      self.active_notes[midi_note_name] = note_data
    else:
      active_note.intensity = note_data.intensity
      active_note.issuers.add(EventMonitor.EVENT_ISSUER_MIDI)

  def on_midi_note_off(self, note_data: NoteData):
    if self.args.debug:
      print("MIDI note off: ", note_data)
    midi_note_name = midi_name_from_note_data(note_data)
    # If the mic is still detecting the note then we shouldn't fade out
    # until the mic stops detecting the note.
    if self.is_mic_connected:
      active_note = self.active_notes.get(midi_note_name, None)
      if active_note is not None and EventMonitor.EVENT_ISSUER_MIC in active_note.issuers:
        return
    self.remove_active_note(midi_note_name, EventMonitor.EVENT_ISSUER_MIDI)

  def on_mic_connected(self):
    print("MIC connected.")
    self.is_mic_connected = True

  def on_mic_disconnected(self):
    print("MIC disconnected.")
    self.is_mic_connected = False
    # Remove mic-only active notes
    self.on_disconnect_remove_notes(EventMonitor.EVENT_ISSUER_MIC)

  def on_mic_note_on(self, note_data):
    if self.args.debug:
      print("MIC note on: ", note_data)
    midi_note_name = midi_name_from_note_data(note_data)
    self.note_on_animation(midi_note_name, note_data)
    # Midi always takes precedence - if midi is connected and the note hasn't been
    # detected yet then we don't add it to the active notes.
    active_note = self.active_notes.get(midi_note_name, None)
    if self.is_midi_connected and active_note:
      return
    self.note_on_animation(midi_note_name, note_data)
    if active_note is None:
      self.active_notes[midi_note_name] = note_data
    else:
      #active_note.intensity = note_data.intensity # Intensity isn't properly implemented for mic yet
      active_note.issuers.add(EventMonitor.EVENT_ISSUER_MIC)

  def on_mic_note_off(self, note_data):
    if self.args.debug:
      print("MIC note off: ", note_data)
    midi_note_name = midi_name_from_note_data(note_data)
    self.remove_active_note(midi_note_name, EventMonitor.EVENT_ISSUER_MIC)
    if midi_note_name not in self.active_notes:
      self.note_off_animation(midi_note_name)

  # ****** END OF CALLBACK FUNCTIONS ******

  def register_callbacks(self):
    self.event_monitor.set_event_callback(
      EventMonitor.EVENT_ISSUER_MIDI, 
      EventMonitor.EVENT_TYPE_CONNECTED, 
      self.on_midi_connected)
    self.event_monitor.set_event_callback(
      EventMonitor.EVENT_ISSUER_MIDI,
      EventMonitor.EVENT_TYPE_DISCONNECTED, 
      self.on_midi_disconnected)
    self.event_monitor.set_event_callback(
      EventMonitor.EVENT_ISSUER_MIDI,
      EventMonitor.EVENT_TYPE_NOTE_ON, 
      self.on_midi_note_on)
    self.event_monitor.set_event_callback(
      EventMonitor.EVENT_ISSUER_MIDI,
      EventMonitor.EVENT_TYPE_NOTE_OFF, 
      self.on_midi_note_off)
    self.event_monitor.set_event_callback(
      EventMonitor.EVENT_ISSUER_MIC,
      EventMonitor.EVENT_TYPE_CONNECTED, 
      self.on_mic_connected)
    self.event_monitor.set_event_callback(
      EventMonitor.EVENT_ISSUER_MIC,
      EventMonitor.EVENT_TYPE_DISCONNECTED,
      self.on_mic_disconnected)
    self.event_monitor.set_event_callback(
      EventMonitor.EVENT_ISSUER_MIC,
      EventMonitor.EVENT_TYPE_NOTE_ON,
      self.on_mic_note_on)
    self.event_monitor.set_event_callback(
      EventMonitor.EVENT_ISSUER_MIC,
      EventMonitor.EVENT_TYPE_NOTE_OFF, 
      self.on_mic_note_off)
    

if __name__ == '__main__':
  args = argparse.ArgumentParser(
    description="Chromesthesia - LED colouring based on music notes.",
    formatter_class=argparse.ArgumentDefaultsHelpFormatter
  )
  args.add_argument("--midi", action="store_true", default=True, help="Use MIDI input.")
  args.add_argument("--mic", action="store_true", default=True, help="Use microphone input.")
  args.add_argument("--debug", action="store_true", default=False, help="Print debug messages.")
  args = args.parse_args()

  event_monitor = EventMonitor()

  # The microphone note detector and the midi note detector will each
  # run in their own threads and interact with each other through this 
  # main thread via a shared event monitor with registered callbacks.
  animator = Animator(event_monitor, args)
  if args.midi:
    midi_note_detector = MidiNoteDetector(event_monitor)
    midi_note_detector.start()
  if args.mic:
    mic_note_detector = MicNoteDetector(event_monitor)
    mic_note_detector.start()

  animator.start()
  try:
    animator.join()
    if args.midi:
      midi_note_detector.terminate()
      midi_note_detector.join()
    if args.mic:
      mic_note_detector.terminate()
      mic_note_detector.join()
  except KeyboardInterrupt:
    # For Ctrl+C to work cleanly
    pass
