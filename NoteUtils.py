
def standardize_note_name(note_name):
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

def note_data_from_midi_name(midi_note_name):
  note_name = midi_note_name[:-1]
  try:
    note_octave = int(midi_note_name[-1])
  except ValueError:
    note_octave = -1
  return note_name, note_octave