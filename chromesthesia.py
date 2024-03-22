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
from Animation import Animation, sqrtstep
from NoteUtils import NoteData, midi_name_from_note_data, note_to_rgb
from ColourUtils import neopixel_gamma, luminance

@dataclass
class NoteColourAnimation:
  note_colour: np.ndarray
  animation: Animation

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
        board.SPI(),
        args.num_leds,
        auto_write=False,
        bpp=3,
        brightness=args.brightness,
        pixel_order=neopixel.RGB
      )
      self.pixels.fill((0,0,0))
      self.pixels.show()

    # Currently active notes, also tracks the set of inputs the notes came from
    # so we can smartly process note on/off events.
    self.active_notes: Dict[str, NoteData] = {}
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
    if self.args.print_colours:
      animated_notes = set()

    colours = []
    for midi_note_name, note_colour_anim in list(self.active_animations.items()):
      note_colour = note_colour_anim.note_colour
      anim = note_colour_anim.animation

      # Use the original note colour as the basis for blending
      # and keep track of the maximum current intensity to scale the final colour.
      curr_brightness = anim.update(dt)
      assert 0.0 <= curr_brightness <= 1.0
      curr_colour = curr_brightness * note_colour
      colours.append(curr_colour)

      # If the animation is done and no longer contributes colour then we remove it
      if anim.is_done() and curr_brightness == 0.0:
        del self.active_animations[midi_note_name]
      else:
        if self.args.print_colours:
          animated_notes.add(midi_note_name)

    # https://stackoverflow.com/questions/649454/what-is-the-best-way-to-average-two-colors-that-define-a-linear-gradient
    luminances = np.array([luminance(l) for l in colours], dtype=np.float32)
    total_luminance = np.sum(luminances)
    total_colour = np.array([0.,0.,0.], dtype=np.float32)
    if total_luminance > 0.0:
      # Weighted average of the colours based on luminance
      for curr_colour, curr_luminance in zip(colours, luminances):
        total_colour += np.power(curr_colour, 2.0) * curr_luminance / total_luminance
      total_colour = np.sqrt(total_colour)
      np.clip(total_colour, 0.0, 1.0, out=total_colour)

    if not np.array_equal(self.prev_total_colour, total_colour):
      if self.pixels is not None:
        self.pixels.fill((
          neopixel_gamma(int(total_colour[0]*255)),
          neopixel_gamma(int(total_colour[1]*255)),
          neopixel_gamma(int(total_colour[2]*255))
        ))
        self.pixels.show()
      if self.args.print_colours:
        print(", ".join(animated_notes), total_colour)

    self.prev_total_colour = total_colour


  def note_on_animation(self, midi_note_name: str, note_data: NoteData):
    note_colour = note_to_rgb(note_data.note_name, note_data.intensity)
    if midi_note_name not in self.active_animations:
      self.active_animations[midi_note_name] = NoteColourAnimation(
        note_colour=note_colour,
        animation=Animation(
          0.0,
          1.0,
          Animator.DEFAULT_ANIM_FADE_IN_TIME_S,
          sqrtstep
        )
      )
    else:
      curr_anim = self.active_animations[midi_note_name].animation
      # TODO: Consider using the distance between the two colours to determine the duration
      curr_anim.reset(
        curr_anim.curr_value,
        1.0,
        Animator.DEFAULT_ANIM_FADE_IN_TIME_S,
      )

  def note_off_animation(self, midi_note_name: str):
    if midi_note_name in self.active_animations:
      # Fade out the note
      note_anim = self.active_animations[midi_note_name].animation
      note_anim.reset(
        1.0,
        0.0,
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
    self.note_on_animation(midi_note_name, note_data)
    # Midi always takes precedence - if midi is connected and the note hasn't been
    # detected yet then we don't add it to the active notes.
    active_note = self.active_notes.get(midi_note_name, None)
    if self.is_midi_connected and active_note:
      return
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
  args.add_argument("--print-colours", action="store_true", default=False, help="Print debug messages showing the RGB.")
  args.add_argument("--print-events", action="store_true", default=False, help="Print debug messages showing the events.")
  args.add_argument("--no-hw", action="store_true", default=False, help="Don't use hardware, just print debug messages.")
  args.add_argument("--num-leds", type=int, default=720, help="Number of LEDs in the strip.")
  args.add_argument("--brightness", type=float, default=1.0, help="LED brightness, must be a value in [0,1].")
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
    animator.terminate()
    if args.midi:
      midi_note_detector.terminate()
      midi_note_detector.join()
    if args.mic:
      mic_note_detector.terminate()
      mic_note_detector.join()
  except KeyboardInterrupt:
    # For Ctrl+C to work cleanly
    pass
