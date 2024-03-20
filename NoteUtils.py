from typing import Set
from dataclasses import dataclass

@dataclass
class NoteData:
  issuers: Set[str]
  note_name: str
  note_octave: int
  intensity: float = 1.0

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

def note_data_from_midi_name(midi_note_name: str):
  note_name = standardize_note_name(midi_note_name[:-1])
  note_octave = int(midi_note_name[-1])
  return note_name, note_octave

def midi_name_from_note_data(note_data: NoteData):
  return note_data.note_name + str(note_data.note_octave)