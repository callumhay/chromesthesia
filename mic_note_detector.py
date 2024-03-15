
import sys
import math
import pyaudio
import json
import numpy as np
import threading
import librosa

class ItemStore(object):
    def __init__(self):
        self.lock = threading.Lock()
        self.items = []

    def add(self, item):
        with self.lock:
            self.items.append(item)

    def getAll(self):
        with self.lock:
            items, self.items = self.items, []
        return items

# Queue of audio data gathered from the microphone in a separate thread
# Emptied and gathered in the main thread
audio_thread_store = ItemStore()


def round_up_to_even(f):
  return int(math.ceil(f / 2.) * 2)

def audio_callback(in_data, frame_count, time_info, status):
  global audio_thread_store
  if status:
    print(status, file=sys.stderr)
  # This code should be as fast as possible:
  # Push the copied data into a synchronized store and GTFO
  audio_data = np.frombuffer(in_data, dtype=np.int16)
  audio_thread_store.add(audio_data)
  return (None, pyaudio.paContinue)


if __name__ == '__main__':
  mic_idx = 0
  audio = pyaudio.PyAudio()
  for i in range(audio.get_device_count()):
    device_info = audio.get_device_info_by_index(i)
    lc_name = device_info['name'].lower()
    if 'built-in' in lc_name and 'microphone' in lc_name:
      mic_idx = i
      break

  device_info = audio.get_device_info_by_index(mic_idx)
  print("Audio device found: ")
  print(device_info)


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
  DT_PER_FRAME_MS = FRAMES_PER_BUFFER / RATE * 1000 # ms
  FFT_WINDOW_SIZE = round_up_to_even(RATE * PREF_FFT_WINDOW_SIZE_MS / 1000) # Number of samples in the FFT window
  FFT_WINDOW_SIZE_MS = FFT_WINDOW_SIZE * 1000 / RATE # ms
  FFT_MAX_WINDOW_SIZE = 2 * FFT_WINDOW_SIZE # Number of samples in the maximum FFT window

  stream = audio.open(
    format=FORMAT, channels=CHANNELS,
    rate=RATE, input=True, output=False,
    input_device_index=mic_idx,
    frames_per_buffer=FRAMES_PER_BUFFER,
    stream_callback=audio_callback
  )

  stream.start_stream()
  curr_audio_accum = []
  while stream.is_active():
    #print("Current queue len: ", len(audio_thread_q.queue))
    curr_audio_accum += audio_thread_store.getAll()
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


    '''
    # Reduce noise... the nr library is too slow, so we'll do a simple clip based on the max energy
    fft_data = np.abs(np.fft.rfft(audio_data, len(audio_data))[1:])
    fft_freq = np.fft.rfftfreq(audio_data.size, d=1./RATE)[1:]
    fft_data[fft_freq > max_note_freq] = 0
    fft_data[fft_freq < min_note_freq] = 0
    max_val = np.amax(fft_data)
    fft_data[fft_data < max_val * 0.7] = 0

    audio_data = np.fft.irfft(fft_data).flatten()
    
    # Use parselmouth to get the fundamental pitches in the audio
    sound = parselmouth.Sound(audio_data, sampling_frequency=RATE)

    # Get the pitch / fundamental frequencies
    try:
      pitch = sound.to_pitch()
      pitch_values = pitch.selected_array['frequency']

      max_pitch_val = np.amax(pitch_values)
      if max_pitch_val > 0:
        print(max_pitch_val)
    except:
      pass
    '''

    '''
    # Put the pitches into bins in the range of reasonable musical notes
    pitch_hist, hist_edges = np.histogram(pitch_values, range=(min_note_freq, max_note_freq), bins=freq_bin_edges)
    if np.any(pitch_hist):
      pitch_indices = pitch_hist.nonzero()[0]
      detected_notes = [note_names[i] for i in pitch_indices]
      print(detected_notes)
    '''

  '''
  # Start the matplotlib window
  plt.ion() # Stop matplotlib windows from blocking
  fig = plt.gcf()
  fig.show()
  fig.canvas.draw()

  stream.start_stream()
  while stream.is_active():

    accum_audio_ms = len(audio_thread_q.queue) * DT_PER_FRAME_MS

    # If the accumulated audio exceeds a certain length, process it
    curr_audio_accum = []
    if accum_audio_ms >= FFT_WINDOW_SIZE_MS:
      while not audio_thread_q.empty():
        curr_audio_accum.append(audio_thread_q.get())

    if len(curr_audio_accum) == 0:
      continue

    # Flatten the list of audio data, apply a hamming window, and take the FFT
    curr_audio_accum = np.array(curr_audio_accum).flatten()
    curr_audio_accum = curr_audio_accum * np.hamming(curr_audio_accum.size)
    fft_data = np.abs(np.fft.rfft(curr_audio_accum)[1:])
    fft_freq = np.fft.rfftfreq(curr_audio_accum.size, d=1./RATE)[1:]

    # Process the FFT data to detect notes:
    # ... Start by cleaning up any noise in the FFT data - remove everything under a given treashold
    fft_data[fft_data < ENERGY_THRESHOLD] = 0

    # ... find the peaks in the FFT data of the top 3 frequencies
    max_inds = np.argpartition(fft_data, -3)[-3:]
    max_sorted_inds = max_inds[np.argsort(fft_data[max_inds])]

    # ... find the closest notes for the peak frequencies
    detected_notes = []
    for peak in max_sorted_inds:
      peak_freq = fft_freq[peak]
      for note_name, note_freq in notes.items():
        if note_freq * 0.99 <= peak_freq <= note_freq * 1.01:
          detected_notes.append(note_name)
          break
    
    if len(detected_notes) > 0:
      print(detected_notes)

    plt.plot(fft_freq, fft_data)
    plt.xlim(np.amin(fft_freq), np.amax(fft_freq))
    fig.canvas.draw()
    #plt.pause(0.05)
    fig.canvas.flush_events()
    fig.clear()
  '''

  stream.stop_stream()
  stream.close()
  audio.terminate()

