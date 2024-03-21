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

# The note names should be organized accruing to the circle of fifths,
# the starting note will be red, all notes along the way are evenly distributed
# across the HSV colour space.
CIRCLE_OF_FIFTHS_NOTE_NAMES = ['A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D']
PCT_BETWEEN_NOTES = 1.0 / len(CIRCLE_OF_FIFTHS_NOTE_NAMES)

# The hue is based on the circle of fifths, starting at the first note in
# CIRCLE_OF_FIFTHS_NOTE_NAMES and going clockwise.
def note_to_hue_pct(note_name):
  return CIRCLE_OF_FIFTHS_NOTE_NAMES.index(note_name) * PCT_BETWEEN_NOTES

# Note colours are based on the Scriabin colour map, but modernized using
# HSV colour space. The colours are based on the circle of fifths, starting at 
# the first note in CIRCLE_OF_FIFTHS_NOTE_NAMES and going clockwise.
def note_to_rgb(note_name, intensity):
  hue = note_to_hue_pct(note_name)
  return np.array(colorsys.hsv_to_rgb(hue, 1.0, intensity), dtype=np.float32)

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