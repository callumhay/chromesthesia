
import rtmidi
import colorsys
import time
import numpy as np
from Animation import Animation

#import board
#import neopixel
#pixels = neopixel.NeoPixel(board.D18, 16)

MIN_VELOCITY = 5.0
SATURATION_VELOCITY = 32.0

# The note names should be organized accruing to the circle of fifths,
# the starting note will be red, all notes along the way are evenly distributed
# across the HSV colour space.
CIRCLE_OF_FIFTHS_NOTE_NAMES = ['A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D']
PCT_BETWEEN_NOTES = 1.0 / len(CIRCLE_OF_FIFTHS_NOTE_NAMES)

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

def note_to_hue_pct(note_name):
  return CIRCLE_OF_FIFTHS_NOTE_NAMES.index(note_name) * PCT_BETWEEN_NOTES

# Note colours are based on the Scriabin colour map, but modernized using
# HSV colour space. The colours are based on the circle of fifths, starting at 
# the first note in CIRCLE_OF_FIFTHS_NOTE_NAMES and going clockwise.
def note_to_rgb(note_name, intensity):
  hue = note_to_hue_pct(note_name)
  return colorsys.hsv_to_rgb(hue, 1.0, intensity)

def note_data_from_midi(midi_note_name):
  note_name = midi_note_name[:-1]
  note_octave = int(midi_note_name[-1])
  return note_name, note_octave

# Set up the MIDI input
midiin = rtmidi.RtMidiIn()

'''
{
  midi_note_name: {
    name,
    brightness, 
    octave
  }
}
- name is the standardized basic note name (C, D, E, etc.) in CIRCLE_OF_FIFTHS_NOTE_NAMES
- brightness is a float in (0, 1]
- octave is an integer based on the midi/piano octave
'''
active_notes = {} 
animations = {}



DEFAULT_ANIM_FADE_IN_TIME_S  = 0.05
DEFAULT_ANIM_FADE_OUT_TIME_S = 0.01

def update_colour(dt):
  total_colour = np.array([0.,0.,0.])
  for midi_note_name, anim in list(animations.items()):
    total_colour += anim.update(dt)
    # If the animation is done and no longer contributes colour then we remove it
    if anim.is_done() and np.array_equal(anim.curr_value, np.array([0.,0.,0.])):
      del animations[midi_note_name]
  
  np.clip(total_colour, 0.0, 1.0, out=total_colour)
  if total_colour.any():
    print(total_colour)
  #pixels.fill((int(total_colour[0]*255), int(total_colour[1]*255), int(total_colour[2]*255)))
  



def update_active_notes(midi):
  global active_notes
  if midi.isNoteOn():
    # Animation cases to consider:
    # 1. New note
    # 2. Note already on
    # 3. Note off (low velocity)

    midi_note_name = midi.getMidiNoteName(midi.getNoteNumber())
    if midi.getVelocity() >= MIN_VELOCITY:
      note_name, note_octave = note_data_from_midi(midi_note_name)
      note_name = standardize_note_name(note_name)
      note_colour = np.array(note_to_rgb(note_name, midi.getVelocity()))
      
      active_notes[midi_note_name] = {
        'name': note_name,
        'octave': note_octave,
      }

      if midi_note_name in animations:
        # Case 2: Note already on - update the animation
        note_anim = animations[midi_note_name]
        note_anim.reset(
          note_anim.curr_value,
          note_colour,
        )

      else:
        # Case 1: New note
        animations[midi_note_name] = Animation(
          np.array([0.,0.,0.]), 
          note_colour, 
          DEFAULT_ANIM_FADE_IN_TIME_S, 
          sqrtstep
        )
    else:
      # Case 3: Note off (low velocity)
      if midi_note_name in active_notes:
        active_notes.pop(midi_note_name, None)
      if midi_note_name in animations:
        # Fade out the note
        note_anim = animations[midi_note_name]
        note_anim.reset(
          note_anim.curr_value,
          np.array([0.,0.,0.]),
          DEFAULT_ANIM_FADE_OUT_TIME_S,
          sqrtstep
        )

  elif midi.isNoteOff():
      midi_note_name = midi.getMidiNoteName(midi.getNoteNumber())
      if midi_note_name in active_notes:
        active_notes.pop(midi_note_name, None)
      if midi_note_name in animations:
        # Fade out the note
        note_anim = animations[midi_note_name]
        note_anim.reset(
          note_anim.curr_value,
          np.array([0.,0.,0.]),
          DEFAULT_ANIM_FADE_OUT_TIME_S,
          sqrtstep
        )


if __name__ == '__main__':
  MIDI_PORT_CHECK_TIME_S = 5.0
  MIDI_GET_MSG_TIMEOUT_MS = 250
  def find_midi_ports(blocking=True):
    ports = []
    while (len(ports) == 0):
      ports = range(midiin.getPortCount())
      if len(ports) == 0 and blocking:
        time.sleep(1)
      else:
        return ports

  midi_ports = []
  while True:
    if len(midi_ports) == 0:
      midi_ports = find_midi_ports()
    else:
      assert len(midi_ports) > 0
      open_port = midi_ports[0]
      midiin.openPort(open_port)
      print('OPENED MIDI PORT:', midiin.getPortName(open_port))
      last_time = time.time()
      last_port_check_time = last_time

      while True:
        current_time = time.time()
        dt = current_time - last_time
        last_time = current_time
        m = midiin.getMessage(MIDI_GET_MSG_TIMEOUT_MS)
        if m:
          update_active_notes(m)
          #print_midi_message(m)
        update_colour(dt)

        # Every so often we should check to see if the midi ports have changed,
        # Unfortunately, the RtMidi library doesn't provide a way to check if the
        # port list has changed or if the device has disconnected, 
        # so we have to do it manually.
        if current_time - last_port_check_time >= MIDI_PORT_CHECK_TIME_S:
          curr_midi_ports = find_midi_ports(blocking=False)
          if len(curr_midi_ports) == 0:
            midiin.closePort()
            midi_ports = []
            print('NO MIDI PORTS FOUND, RETRYING...')
            break
          else:
            midi_ports = curr_midi_ports