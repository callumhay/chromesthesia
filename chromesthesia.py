import time
import math
import argparse
from multiprocessing import Process
from typing import Dict
from dataclasses import dataclass

import numpy as np

from EventMonitor import EventMonitor
from MicNoteDetector import MicNoteDetector
from MidiNoteDetector import MidiNoteDetector
from Animation import Animation, sqrtstep, smoothstep
from NoteUtils import NoteData, midi_name_from_note_data, note_to_rgb, note_data_from_midi_name, generate_all_possible_midi_names
from ColourUtils import gamma

@dataclass
class NoteColourAnimation:
  note_colour: np.ndarray
  animation: Animation

@dataclass
class NoteHistory:
  start_time: float = float('-inf')
  end_time: float = float('-inf')

class Animator(Process):
  OFF_COLOUR = np.array([0.,0.,0.], dtype=np.float32)
  DEFAULT_ANIM_FADE_IN_TIME_S  = 0.05
  DEFAULT_ANIM_FADE_OUT_TIME_S = 0.1

  def __init__(self, event_monitor: EventMonitor, args: argparse.Namespace):
    super(Animator, self).__init__()
    self.args = args
    self.is_midi_connected = False
    self.is_mic_connected = False

    if args.no_hw:
      self.pixels = None
    else:
      import board
      import neopixel_spi as neopixel
      self.pixels = neopixel.NeoPixel_SPI(
        spi=board.SPI(),
        n=args.num_leds,
        auto_write=False,
        bpp=3,
        brightness=args.brightness,
        pixel_order=neopixel.RGB,
      )
      self.pixels.fill((0,0,0))
      self.pixels.show()

    # Currently active notes, also tracks the set of inputs the notes came from
    # so we can smartly process note on/off events.
    self.active_notes: Dict[str, NoteData] = {}
    # Midi note history - keep track of times when notes have been active via MIDI
    self.midi_note_history: Dict[str, NoteHistory] = {}

    # Currently active colour animations - these are the animations that are
    # currently contributing to the total colour of the LEDs. They are mapped
    # to the midi note name that they are animating.
    self.active_animations: Dict[str, NoteColourAnimation] = {}
    # Used to track if the colour has changed
    self.prev_total_colour = np.array(
      [math.nan, math.nan, math.nan], dtype=np.float32
    )
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
    dt = min(dt, 0.1) # Cap the delta time to prevent large jumps in colour

    if self.args.print_colours:
      animated_notes = set()

    notes_already_seen = {}
    filtered_anims = {}
    for midi_note_name, note_colour_anim in self.active_animations.items():
      note_name, _ = note_data_from_midi_name(midi_note_name)
      anim = note_colour_anim.animation
      curr_brightness = anim.update(dt)
      if note_name in notes_already_seen:
        if curr_brightness > notes_already_seen[note_name]:
          notes_already_seen[note_name] = curr_brightness
          filtered_anims[midi_note_name] = self.active_animations[midi_note_name]
      else:
        notes_already_seen[note_name] = curr_brightness
        filtered_anims[midi_note_name] = self.active_animations[midi_note_name]

    note_colours = []
    brightnesses = []
    for midi_note_name, note_colour_anim in list(self.active_animations.items()):
      note_colour = note_colour_anim.note_colour
      anim = note_colour_anim.animation

      # Use the original note colour as the basis for blending
      # and keep track of the maximum current intensity to scale the final colour.
      curr_brightness = anim.curr_value
      assert 0.0 <= curr_brightness <= 1.0

      if midi_note_name in filtered_anims:
        brightnesses.append(curr_brightness)
        note_colours.append(note_colour)

      # If the animation is done and no longer contributes colour then we remove it
      if anim.is_done() and curr_brightness == 0.0:
        del self.active_animations[midi_note_name]
      elif self.args.print_colours:
        animated_notes.add(midi_note_name)

    total_brightness = np.sum(brightnesses)
    total_colour = np.copy(Animator.OFF_COLOUR)
    if total_brightness > 0.0 and len(note_colours) > 0:
      #max_idx = np.argmax(brightnesses)
      #total_colour = note_colours[max_idx] * brightnesses[max_idx]
      for brightness, note_colour in zip(brightnesses, note_colours):
        total_colour = note_colour * brightness + (1.0 - brightness/total_brightness) * total_colour

      np.nan_to_num(total_colour, copy=False, nan=0.0)
      np.clip(total_colour, 0.0, 1.0, out=total_colour)

    if not np.array_equal(self.prev_total_colour, total_colour):
      if self.pixels is not None:
        self.pixels.fill((
          gamma(round(total_colour[0]*255)),
          gamma(round(total_colour[1]*255)),
          gamma(round(total_colour[2]*255))
        ))
        self.pixels.show()
      if self.args.print_colours:
        print(", ".join(animated_notes), total_colour)

    self.prev_total_colour = total_colour


  def note_on_animation(self, midi_note_name: str, note_data: NoteData):
    curr_anim_value = 0.0
    if midi_note_name in self.active_animations:
      curr_anim_value = self.active_animations[midi_note_name].animation.curr_value
    else:
      # Check whether the same note is already active (regardless of octave)
      note_name, _ = note_data_from_midi_name(midi_note_name)
      possible_midi_names = generate_all_possible_midi_names(note_name)
      active_similar_anims = {k:v for k,v in self.active_animations.items() if k in possible_midi_names}
      # If there are similar note(s) already active then we set the current brightness animation
      # to the already animating value of the highest brightness note
      for v in active_similar_anims.values():
        if v.animation.curr_value > curr_anim_value:
          curr_anim_value = v.animation.curr_value
      for note_colour_anim in active_similar_anims.values():
        note_colour_anim.animation.curr_value = curr_anim_value

    # Create the new animation
    # TODO: Consider using the distance between the curr_anim_value and 1.0 to determine the duration
    # of the brightness increase?
    rgb_note_colour = note_to_rgb(note_data.note_name, note_data.intensity)
    self.active_animations[midi_note_name] = NoteColourAnimation(
      note_colour=rgb_note_colour,
      animation=Animation(
        curr_anim_value,
        1.0,
        Animator.DEFAULT_ANIM_FADE_IN_TIME_S,
        sqrtstep
      )
    )

  def note_off_animation(self, midi_note_name: str):
    if midi_note_name in self.active_animations:
      # Fade-out the note
      # TODO: Consider using the distance between the curr_anim_value and 0.0 to determine the duration
      # of the brightness decrease?
      note_anim = self.active_animations[midi_note_name].animation
      curr_anim_value = note_anim.curr_value
      note_anim.reset(
        curr_anim_value,
        0.0,
        Animator.DEFAULT_ANIM_FADE_OUT_TIME_S,
        smoothstep
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
    if issuer == EventMonitor.EVENT_ISSUER_MIDI:
      for k in notes_to_remove:
        self.midi_note_history[k].end_time = time.time()

  def remove_active_note(self, midi_note_name: str, issuer: str):
    note_data = self.active_notes.get(midi_note_name, None)
    if note_data is not None:
      note_data.issuers.discard(issuer)
      if len(note_data.issuers) == 0:
        if issuer == EventMonitor.EVENT_ISSUER_MIDI:
          self.midi_note_history[midi_note_name].end_time = time.time()
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
    if self.args.print_events:
      print("MIDI note on: ", note_data)
    midi_note_name = midi_name_from_note_data(note_data)
    self.note_on_animation(midi_note_name, note_data)
    active_note = self.active_notes.get(midi_note_name, None)
    if active_note is None:
      self.active_notes[midi_note_name] = note_data
    else:
      active_note.intensity = note_data.intensity
      active_note.issuers.add(EventMonitor.EVENT_ISSUER_MIDI)

    note_history = self.midi_note_history.get(midi_note_name, None)
    if note_history is None:
      note_history = NoteHistory()
      self.midi_note_history[midi_note_name] = note_history
    note_history.start_time = time.time()

  def on_midi_note_off(self, note_data: NoteData):
    if self.args.print_events:
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
    if self.args.print_events:
      print("MIC note on: ", note_data)

    midi_note_name = midi_name_from_note_data(note_data)
    active_note = self.active_notes.get(midi_note_name, None)
    if not self.args.no_midi_priority and self.is_midi_connected:
      pass
    else:
      self.note_on_animation(midi_note_name, note_data)
      if active_note is None:
        self.active_notes[midi_note_name] = note_data
      else:
        #active_note.intensity = note_data.intensity # Intensity isn't properly implemented for mic yet
        active_note.issuers.add(EventMonitor.EVENT_ISSUER_MIC)

  def on_mic_note_off(self, note_data):
    if self.args.print_events:
      print("MIC note off: ", note_data)
    midi_note_name = midi_name_from_note_data(note_data)
    self.remove_active_note(midi_note_name, EventMonitor.EVENT_ISSUER_MIC)

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
  args.add_argument("--midi-port-name", type=str, default="USB MIDI Interface", help="Name of the MIDI port to connect to.")
  args.add_argument("--no-midi-priority", action="store_true", default=False, help="Don't give MIDI priority over mic (active only when midi is connected).")
  args.add_argument("--print-colours", action="store_true", default=False, help="Print debug messages showing the RGB.")
  args.add_argument("--print-events", action="store_true", default=False, help="Print debug messages showing the events.")
  args.add_argument("--no-hw", action="store_true", default=False, help="Don't use hardware, just print debug messages.")
  args.add_argument("--num-leds", type=int, default=19, help="Number of LEDs in the strip.")
  args.add_argument("--brightness", type=float, default=1.0, help="LED brightness, must be a value in [0,1].")
  args = args.parse_args()

  event_monitor = EventMonitor()

  # The microphone note detector and the midi note detector will each
  # run in their own threads and interact with each other through this
  # main thread via a shared event monitor with registered callbacks.
  animator = Animator(event_monitor, args)
  midi_note_detector = MidiNoteDetector(event_monitor, args)
  midi_note_detector.start()
  mic_note_detector = MicNoteDetector(event_monitor, args)
  mic_note_detector.start()
  animator.start()

  try:
    animator.join()
    midi_note_detector.join()
    mic_note_detector.join()
  except KeyboardInterrupt:
    # For Ctrl+C to work cleanly
    pass

  animator.terminate()
  mic_note_detector.terminate()
  midi_note_detector.terminate()
