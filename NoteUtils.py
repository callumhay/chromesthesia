import os
import json
import colorsys
from typing import Set
from dataclasses import dataclass
import numpy as np

# Used to store and transmit data about a note being on/off
# from the input (e.g., mic, midi) detector threads to the main thread.
@dataclass
class NoteData:
  issuers: Set[str]
  note_name: str
  note_octave: int
  intensity: float = 1.0

# Note colours are the single source of truth shared with the web visualization
# (web/ view). They live in note_colours.json at the repo root so editing a
# colour updates both the LEDs and the web view. The order follows the circle
# of fifths: the starting note is red and notes are distributed around the
# colour space from there.
_NOTE_COLOURS_JSON = os.path.join(os.path.dirname(__file__), 'note_colours.json')
with open(_NOTE_COLOURS_JSON, 'r') as _f:
  _note_colour_data = json.load(_f)

CIRCLE_OF_FIFTHS_NOTE_NAMES = list(_note_colour_data['circle_of_fifths'])
NOTE_COLOURS = [
  list(_note_colour_data['colours'][name]) for name in CIRCLE_OF_FIFTHS_NOTE_NAMES
]

PCT_BETWEEN_NOTES = 1.0 / len(CIRCLE_OF_FIFTHS_NOTE_NAMES)

# The hue is based on the circle of fifths, starting at the first note in
# CIRCLE_OF_FIFTHS_NOTE_NAMES and going clockwise.
def note_to_hue_pct(note_name):
  return CIRCLE_OF_FIFTHS_NOTE_NAMES.index(note_name) * PCT_BETWEEN_NOTES

# Note colours are based on the Scriabin colour map, but modernized using
# HSV colour space. The colours are based on the circle of fifths, starting at
# the first note in CIRCLE_OF_FIFTHS_NOTE_NAMES and going clockwise.
def note_to_rgb(note_name, intensity):
  return np.array(NOTE_COLOURS[CIRCLE_OF_FIFTHS_NOTE_NAMES.index(note_name)], dtype=np.float32)
  #hue = note_to_hue_pct(note_name)
  #return np.array(colorsys.hsv_to_rgb(hue, 1.0, intensity), dtype=np.float32)

# Make sure note names conform to the set of names in CIRCLE_OF_FIFTHS_NOTE_NAMES
def standardize_note_name(note_name: str):
  if note_name == 'C#':
    note_name = 'Db'
  elif note_name == 'D#':
    note_name = 'Eb'
  elif note_name == 'F#':
    note_name = 'Gb'
  elif note_name == 'G#':
    note_name = 'Ab'
  elif note_name == 'A#':
    note_name = 'Bb'
  return note_name

# Parses the standardized root note name and octave from a given midi note name string
def note_data_from_midi_name(midi_note_name: str):
  note_name = standardize_note_name(midi_note_name[:-1])
  note_octave = int(midi_note_name[-1])
  return note_name, note_octave

# Returns the midi note name (<note><octave>) from the given note data
def midi_name_from_note_data(note_data: NoteData):
  return note_data.note_name + str(note_data.note_octave)

def generate_midi_indices(note_name: str):
  if note_name == 'A' or  note_name == 'B' or note_name == 'Bb':
    indices = list(range(0, 8))
  elif note_name == 'C':
    indices = list(range(1, 9))
  else:
    indices = list(range(1,8))
  return indices

def generate_all_possible_midi_names(note_name: str):
  indices = generate_midi_indices(note_name)
  return [note_name + str(i) for i in indices]