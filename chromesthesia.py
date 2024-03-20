import time
import math
import colorsys
from typing import Dict, Set
import numpy as np

from EventMonitor import EventMonitor
from MicNoteDetector import MicNoteDetector
from MidiNoteDetector import MidiNoteDetector
from Animation import Animation, sqrtstep
from NoteUtils import NoteData, midi_name_from_note_data

# The note names should be organized accruing to the circle of fifths,
# the starting note will be red, all notes along the way are evenly distributed
# across the HSV colour space.
CIRCLE_OF_FIFTHS_NOTE_NAMES = ['A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D']
PCT_BETWEEN_NOTES = 1.0 / len(CIRCLE_OF_FIFTHS_NOTE_NAMES)

DEFAULT_ANIM_FADE_IN_TIME_S  = 0.05
DEFAULT_ANIM_FADE_OUT_TIME_S = 0.01

is_midi_connected = False
is_mic_connected = False

# Currently active notes, also tracks the set of inputs the notes came from
# so we can smartly process note on/off events.
active_notes: Dict[str, NoteData] = {}

# Currently active colour animations - these are the animations that are
# currently contributing to the total colour of the LEDs. They are mapped
# to the midi note name that they are animating.
active_animations: Dict[str, Animation] = {}

def note_to_hue_pct(note_name):
  return CIRCLE_OF_FIFTHS_NOTE_NAMES.index(note_name) * PCT_BETWEEN_NOTES

# Note colours are based on the Scriabin colour map, but modernized using
# HSV colour space. The colours are based on the circle of fifths, starting at 
# the first note in CIRCLE_OF_FIFTHS_NOTE_NAMES and going clockwise.
def note_to_rgb(note_name, intensity):
  hue = note_to_hue_pct(note_name)
  return np.array(colorsys.hsv_to_rgb(hue, 1.0, intensity), dtype=np.float32)

prev_total_colour = np.array([math.nan,math.nan,math.nan])
def update_colour(dt):
  global active_animations, prev_total_colour
  animated_notes = set()
  total_colour = np.array([0.,0.,0.])
  for midi_note_name, anim in list(active_animations.items()):
    total_colour += anim.update(dt)
    # If the animation is done and no longer contributes colour then we remove it
    if anim.is_done() and np.array_equal(anim.curr_value, np.array([0.,0.,0.])):
      del active_animations[midi_note_name]
    else:
      animated_notes.add(midi_note_name)
  
  np.clip(total_colour, 0.0, 1.0, out=total_colour)
  if not np.array_equal(prev_total_colour, total_colour):
    print(", ".join(animated_notes), total_colour)
  
  prev_total_colour = total_colour

  # TODO: Set the LEDs to the total_colour
  #pixels.fill((int(total_colour[0]*255), int(total_colour[1]*255), int(total_colour[2]*255)))
  
def note_on_animation(midi_note_name: str, note_data: NoteData):
  global active_animations
  note_colour = note_to_rgb(note_data.note_name, note_data.intensity)
  if midi_note_name not in active_animations:
    active_animations[midi_note_name] = Animation(
      np.array([0.,0.,0.]), 
      note_colour,  
      DEFAULT_ANIM_FADE_IN_TIME_S,
      sqrtstep
    )
  else:
    curr_anim = active_animations[midi_note_name]
    # TODO: Consider using the distance between the two colours to determine the duration
    curr_anim.reset(
      curr_anim.curr_value,
      note_colour,
      DEFAULT_ANIM_FADE_IN_TIME_S, 
    )
  
def note_off_animation(midi_note_name: str):
  global active_animations
  if midi_note_name in active_animations:
    # Fade out the note
    note_anim = active_animations[midi_note_name]
    note_anim.reset(
      note_anim.curr_value,
      np.array([0.,0.,0.]),
      DEFAULT_ANIM_FADE_OUT_TIME_S,
      sqrtstep
    )

def on_disconnect_remove_notes(issuer: str):
  global active_notes
  notes_to_remove = []
  for k,v in active_notes.items():
    if v.issuers.difference({issuer}) == set():
      notes_to_remove.append(k)
    else:
      v.issuers.discard(issuer)
  for k in notes_to_remove:
    del active_notes[k]
    note_off_animation(k)


def remove_active_note(midi_note_name: str, issuer: str):
  global active_notes
  note_data = active_notes.get(midi_note_name, None)
  if note_data is not None:
    note_data.issuers.discard(issuer)
    if len(note_data.issuers) == 0:
      del active_notes[midi_note_name]
      note_off_animation(midi_note_name)

# The main thread will run the event monitor and the note detectors
# in separate threads. The note detectors will interact with each other
# through the event monitor which calls the following callback functions
# ****** START OF CALLBACK FUNCTIONS ******

def on_midi_connected():
  global is_midi_connected
  print("MIDI connected.")
  is_midi_connected = True

def on_midi_disconnected():
  global is_midi_connected
  print("MIDI disconnected.")
  is_midi_connected = False
  # Remove midi-only active notes
  on_disconnect_remove_notes(EventMonitor.EVENT_ISSUER_MIDI)

def on_midi_note_on(note_data: NoteData):
  global active_notes
  #print("MIDI note on: ", note_data)
  midi_note_name = midi_name_from_note_data(note_data)
  note_on_animation(midi_note_name, note_data)
  active_note = active_notes.get(midi_note_name, None)
  if active_note is None:
    active_notes[midi_note_name] = note_data
  else:
    active_note.intensity = note_data.intensity
    active_note.issuers.add(EventMonitor.EVENT_ISSUER_MIDI)

def on_midi_note_off(note_data: NoteData):
  print("MIDI note off: ", note_data)
  midi_note_name = midi_name_from_note_data(note_data)
  # If the mic is still detecting the note then we shouldn't fade out
  # until the mic stops detecting the note.
  if is_mic_connected:
    active_note = active_notes.get(midi_note_name, None)
    if active_note is not None and EventMonitor.EVENT_ISSUER_MIC in active_note.issuers:
      return
  remove_active_note(midi_note_name, EventMonitor.EVENT_ISSUER_MIDI)

def on_mic_connected():
  global is_mic_connected
  print("MIC connected")
  is_mic_connected = True

def on_mic_disconnected():
  global is_mic_connected
  print("MIC disconnected")
  is_mic_connected = False
  # Remove mic-only active notes
  on_disconnect_remove_notes(EventMonitor.EVENT_ISSUER_MIC)

def on_mic_note_on(note_data):
  #print("MIC note on: ", note_data)
  midi_note_name = midi_name_from_note_data(note_data)
  note_on_animation(midi_note_name, note_data)
  # Midi always takes precedence - if midi is connected and the note hasn't been
  # detected yet then we don't add it to the active notes.
  active_note = active_notes.get(midi_note_name, None)
  if is_midi_connected and active_note:
    return
  note_on_animation(midi_note_name, note_data)
  if active_note is None:
    active_notes[midi_note_name] = note_data
  else:
    #active_note.intensity = note_data.intensity # Intensity isn't properly implemented for mic yet
    active_note.issuers.add(EventMonitor.EVENT_ISSUER_MIC)

def on_mic_note_off(note_data):
  #print("MIC note off: ", note_data)
  midi_note_name = midi_name_from_note_data(note_data)
  remove_active_note(midi_note_name, EventMonitor.EVENT_ISSUER_MIC)
  if midi_note_name not in active_notes:
    note_off_animation(midi_note_name)

def register_callbacks(event_monitor):
  event_monitor.set_event_callback(
    EventMonitor.EVENT_ISSUER_MIDI, 
    EventMonitor.EVENT_TYPE_CONNECTED, 
    on_midi_connected)
  event_monitor.set_event_callback(
    EventMonitor.EVENT_ISSUER_MIDI,
    EventMonitor.EVENT_TYPE_DISCONNECTED, 
    on_midi_disconnected)
  event_monitor.set_event_callback(
    EventMonitor.EVENT_ISSUER_MIDI,
    EventMonitor.EVENT_TYPE_NOTE_ON, 
    on_midi_note_on)
  event_monitor.set_event_callback(
    EventMonitor.EVENT_ISSUER_MIDI,
    EventMonitor.EVENT_TYPE_NOTE_OFF, 
    on_midi_note_off)
  event_monitor.set_event_callback(
    EventMonitor.EVENT_ISSUER_MIC,
    EventMonitor.EVENT_TYPE_CONNECTED, 
    on_mic_connected)
  event_monitor.set_event_callback(
    EventMonitor.EVENT_ISSUER_MIC,
    EventMonitor.EVENT_TYPE_DISCONNECTED,
    on_mic_disconnected)
  event_monitor.set_event_callback(
    EventMonitor.EVENT_ISSUER_MIC,
    EventMonitor.EVENT_TYPE_NOTE_ON,
    on_mic_note_on)
  event_monitor.set_event_callback(
    EventMonitor.EVENT_ISSUER_MIC,
    EventMonitor.EVENT_TYPE_NOTE_OFF, 
    on_mic_note_off)
  
# ****** END OF CALLBACK FUNCTIONS ******

if __name__ == '__main__':
  event_monitor = EventMonitor()
  register_callbacks(event_monitor)

  # The microphone note detector and the midi note detector will each
  # run in their own threads and interact with each other through this 
  # main thread via a shared event monitor with registered callbacks.
  mic_note_detector = MicNoteDetector(event_monitor)
  midi_note_detector = MidiNoteDetector(event_monitor)
  mic_note_detector.start()
  midi_note_detector.start()

  last_time = time.time()
  while True:
    # NO BLOCKING HERE: We need animations to continue updating
    # even if there are no events to process
    event_monitor.process_events()

    # Update the colour of the LEDs via the active animations
    current_time = time.time()
    dt = current_time - last_time
    update_colour(dt)
    last_time = current_time

    # A very minor sleep seems to prevent thread starvation... 
    # TODO: If you find a better solution out there then replace this.
    time.sleep(0.0001)

  #mic_note_detector.join()
  #midi_note_detector.join()
