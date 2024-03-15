
import rtmidi
import colorsys
import time
import numpy as np
#import librosa

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
# C (red) and going clockwise.
def note_to_rgb(note_name, velocity):
  brightness = max(0.0, min(SATURATION_VELOCITY, velocity) / SATURATION_VELOCITY)
  hue = note_to_hue_pct(note_name)
  return colorsys.hsv_to_rgb(hue, 1.0, brightness)

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

def lerpstep(y0, y1, x):
  assert 0.0 <= x <= 1.0
  return y0 * (1.0 - x) + y1 * x

def smoothstep(y0, y1, x):
  v = max(0.0, min(1.0, ((x - y0) / (y1 - y0))))
  return v * v * (3.0 - 2.0 * v)

def sqrtstep(y0, y1, x):
  assert 0.0 <= x <= 1.0
  sqrt_x = np.sqrt(x)
  return lerpstep(y0, y1, sqrt_x)

DEFAULT_ANIM_FADE_IN_TIME_S  = 0.05
DEFAULT_ANIM_FADE_OUT_TIME_S = 0.01
class Animation:
  def __init__(self, init_value, final_value, duration_s, interpolation_fn):
    assert duration_s > 0.0
    self.reset(init_value, final_value, duration_s, interpolation_fn)
    
  def reset(self, init_value, final_value, duration_s=None, interpolation_fn=None):
    self.init_value = init_value
    self.final_value = final_value
    self.curr_value = init_value
    self._t = 0.0
    if duration_s is not None:
      self.duration = duration_s
    if interpolation_fn is not None:
      self.interpolation_fn = interpolation_fn
  
  def update(self, dt):
    assert dt >= 0.0
    self._t += dt
    p = 1.0
    if self.duration > 0:
      p = max(0.0, min(1.0, self._t / self.duration))
    self.curr_value = self.interpolation_fn(self.init_value, self.final_value, p)
    return self.curr_value
  
  def is_done(self):
    return self._t >= self.duration

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
  

def print_message(midi):
  if midi.isNoteOn():
    print('ON: ', midi.getMidiNoteName(midi.getNoteNumber()), midi.getVelocity())
  elif midi.isNoteOff():
    print('OFF:', midi.getMidiNoteName(midi.getNoteNumber()))
  elif midi.isController():
    print('CONTROLLER', midi.getControllerNumber(), midi.getControllerValue())

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
        m = midiin.getMessage(1) # timeout in ms
        if m:
          update_active_notes(m)
          #print_message(m)
        update_colour(dt)

        # Every so often we should check to see if the midi ports have changed
        if current_time - last_port_check_time >= MIDI_PORT_CHECK_TIME_S:
          curr_midi_ports = find_midi_ports(blocking=False)
          if len(curr_midi_ports) == 0:
            midiin.closePort()
            midi_ports = []
            print('NO MIDI PORTS FOUND, RETRYING...')
            break
          else:
            midi_ports = curr_midi_ports