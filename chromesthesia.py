from MicNoteDetector import MicNoteDetector

if __name__ == '__main__':

  # The microphone note detector and the midi note detector will each
  # run in their own threads and interact with each other
  # through this main thread via callbacks and a shared item store
  mic_note_detector = MicNoteDetector()
  #midi_note_detector = MidiNoteDetector()
  mic_note_detector.start()
  #midi_note_detector.start()

  mic_note_detector.join()
  #midi_note_detector.join()
