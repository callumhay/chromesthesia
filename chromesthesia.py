import time
import colorsys

from EventMonitor import EventMonitor
from MicNoteDetector import MicNoteDetector
from MidiNoteDetector import MidiNoteDetector
from Animation import Animation, sqrtstep

# The note names should be organized accruing to the circle of fifths,
# the starting note will be red, all notes along the way are evenly distributed
# across the HSV colour space.
CIRCLE_OF_FIFTHS_NOTE_NAMES = ['A', 'E', 'B', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D']
PCT_BETWEEN_NOTES = 1.0 / len(CIRCLE_OF_FIFTHS_NOTE_NAMES)

#active_notes = {}
#animations = {}



def note_to_hue_pct(note_name):
  return CIRCLE_OF_FIFTHS_NOTE_NAMES.index(note_name) * PCT_BETWEEN_NOTES

# Note colours are based on the Scriabin colour map, but modernized using
# HSV colour space. The colours are based on the circle of fifths, starting at 
# the first note in CIRCLE_OF_FIFTHS_NOTE_NAMES and going clockwise.
def note_to_rgb(note_name, intensity):
  hue = note_to_hue_pct(note_name)
  return colorsys.hsv_to_rgb(hue, 1.0, intensity)

# The main thread will run the event monitor and the note detectors
# in separate threads. The note detectors will interact with each other
# through the event monitor which calls the following callback functions
# ****** START OF CALLBACK FUNCTIONS ******

def on_midi_connected():
  print("MIDI connected")

def on_midi_disconnected():
  print("MIDI disconnected")

def on_midi_note_on(note_data):
  print("MIDI note on: ", note_data)

def on_midi_note_off(note_data):
  print("MIDI note off: ", note_data)

def on_mic_connected():
  print("MIC connected")

def on_mic_disconnected():
  print("MIC disconnected")

def on_mic_note_on(note_data):
  print("MIC note on: ", note_data)

def on_mic_note_off(note_data):
  print("MIC note off: ", note_data)

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
  # run in their own threads and interact with each other
  # through this main thread via callbacks and a shared item store
  mic_note_detector = MicNoteDetector(event_monitor)
  midi_note_detector = MidiNoteDetector(event_monitor)

  mic_note_detector.start()
  midi_note_detector.start()

  while True:
    # NO BLOCKING HERE: We need animations to continue updating
    # even if there are no events to process
    event_monitor.process_events()

    # TODO: Animation updates go here
    


    # A very minor sleep seems to prevent thread starvation... 
    # TODO: If you find a better solution out there then replace this.
    time.sleep(0.001)
    
    
    

  mic_note_detector.join()
  midi_note_detector.join()
