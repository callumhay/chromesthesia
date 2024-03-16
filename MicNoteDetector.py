import sys
import math
import time
from threading import Thread
import pyaudio
import numpy as np
import librosa

from ItemStore import ItemStore

def round_up_to_even(f):
  return int(math.ceil(f / 2.) * 2)

class MicNoteDetector(Thread):

  def __init__(self):
    super(MicNoteDetector, self).__init__()
    self.audio = None
    self.stream = None
    self.mic_idx = -1
    # Audio data gathered from the microphone in a separate thread (see the audio_callback() method).
    # Emptied and gathered in the main thread (see the run() method).
    self.audio_thread_store = ItemStore()

  def _init_audio(self):
    if self.audio is not None:
      self.audio.terminate()
    self.audio = pyaudio.PyAudio()
    if self.stream is not None:
      self.stream.stop_stream()
      self.stream.close()
    self.stream = None
    self.mic_idx  = -1

  def _find_mic(self):
    mic_idx = -1
    for i in range(self.audio.get_device_count()):
      device_info = self.audio.get_device_info_by_index(i)
      lc_name = device_info['name'].lower()
      if 'built-in' in lc_name and 'microphone' in lc_name:
        mic_idx = i
        break
    return mic_idx

  # NOTE: This function is called in a separate thread by the pyaudio library
  # Make sure to keep it as fast as possible and any cross-thread communication
  # is done through the audio_thread_store (i.e., kept synchronized with the main thread)
  def _audio_callback(self, in_data, frame_count, time_info, status):
    if status:
      print(status, file=sys.stderr)
    audio_data = np.frombuffer(in_data, dtype=np.int16)
    self.audio_thread_store.add(audio_data)
    return (None, pyaudio.paContinue)

  def _start_audio_stream(self):
    device_info = self.audio.get_device_info_by_index(self.mic_idx)
    print("Audio device (mic) found: ")
    print(device_info)
    print("Connecting device...")

    FORMAT = pyaudio.paInt16
    CHANNELS = 1
    RATE = int(device_info['defaultSampleRate']) # Hz (samples per second of audio data)

    # Number of updates per second for gathering frames of audio from the mic
    # This number needs to be high enough to provide the FFT with enough data 
    # to resolve the frequencies with reasonable latency
    # >= 4096 seems to be a good choice
    PREF_UPDATES_PER_SECOND = 4096

    # The FFT window should be quite small to resolve the frequencies with reasonable latency
    # 10 ms seems to be a good choice, anything more than 25 ms is too slow
    PREF_FFT_WINDOW_SIZE_MS = 10 

    # Don't touch these
    FRAMES_PER_BUFFER = round_up_to_even(RATE / PREF_UPDATES_PER_SECOND)
    #DT_PER_FRAME_MS = FRAMES_PER_BUFFER / RATE * 1000 # ms
    FFT_WINDOW_SIZE = round_up_to_even(RATE * PREF_FFT_WINDOW_SIZE_MS / 1000) # Number of samples in the FFT window
    #FFT_WINDOW_SIZE_MS = FFT_WINDOW_SIZE * 1000 / RATE # ms
    FFT_MAX_WINDOW_SIZE = 2 * FFT_WINDOW_SIZE # Number of samples in the maximum FFT window

    self.stream = self.audio.open(
      format=FORMAT, channels=CHANNELS,
      rate=RATE, input=True, output=False,
      input_device_index=self.mic_idx,
      frames_per_buffer=FRAMES_PER_BUFFER,
      stream_callback=self._audio_callback
    )

    self.stream.start_stream()
    curr_audio_accum = []
    while self.stream.is_active():
      #print("Current queue len: ", len(audio_thread_q.queue))
      curr_audio_accum += self.audio_thread_store.getAll()
      if len(curr_audio_accum) > FFT_MAX_WINDOW_SIZE:
        curr_audio_accum = curr_audio_accum[-FFT_MAX_WINDOW_SIZE:]
      elif len(curr_audio_accum) < FFT_WINDOW_SIZE:
        continue
      
      audio_data = np.array(curr_audio_accum, dtype=np.float32).flatten()
      #audio_data = audio_data * np.hamming(audio_data.size)

      f0, voiced_flag, voiced_probs = librosa.pyin(
        audio_data,
        sr=RATE,
        fmin=librosa.note_to_hz('C2'),
        fmax=librosa.note_to_hz('C7')
      )
      possible_note_inds = voiced_probs > 0.5
      if np.any(possible_note_inds) > 0:
        print(librosa.hz_to_note(f0[possible_note_inds], unicode=False))

      curr_audio_accum = curr_audio_accum[-math.floor(0.5*FFT_WINDOW_SIZE):]

    self.stream.stop_stream()
    self.stream.close()
    self.stream = None
    self.mic_idx = -1
  
  # Main thread - runs forever, constantly trying to find a microphone and
  # start an audio stream from it for note detection.
  def run(self):
    MAX_SLEEP_TIME_S = 16
    find_mic_wait_time_s = 1
    self._init_audio()
    while True:
      try:
        self.mic_idx = self._find_mic()
        if self.mic_idx == -1:
          print("Microphone not found. Sleeping for a bit and trying again...")
          time.sleep(find_mic_wait_time_s)
          find_mic_wait_time_s = min(2*find_mic_wait_time_s, MAX_SLEEP_TIME_S)
          continue
        else:
          self._start_audio_stream()
          find_mic_wait_time_s = 1
      except Exception as e:
        print("Error occurred in Mic Note Detector Thread: ", e)
        print("Reinitializing Mic Note Detector and restarting...")
        self._init_audio()