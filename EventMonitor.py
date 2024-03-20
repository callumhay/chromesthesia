from ItemStore import ItemStore

class EventMonitor(object):
  
  EVENT_ISSUER_MIC = "MIC"
  EVENT_ISSUER_MIDI = "MIDI"
  # Lower value means higher priority
  ISSUER_PRIORITY = {
    EVENT_ISSUER_MIDI: 0,
    EVENT_ISSUER_MIC: 1,
  }

  EVENT_TYPE_CONNECTED = "CONNECTED"
  EVENT_TYPE_DISCONNECTED = "DISCONNECTED"
  EVENT_TYPE_NOTE_ON = "NOTE_ON"
  EVENT_TYPE_NOTE_OFF = "NOTE_OFF"

  def __init__(self):
    self.event_queue = ItemStore()
    self.callbacks = {
      self.EVENT_ISSUER_MIC: {},
      self.EVENT_ISSUER_MIDI: {},
    }
  
  def set_event_callback(self, issuer, event_type, callback):
    self.callbacks[issuer][event_type] = callback
  
  # Called from the midi and mic note detectors on their respective threads
  def on_event(self, issuer, event_type, event_data=None):
    self.event_queue.add((issuer, event_type, event_data))

  # Called from the main thread
  def process_events(self):
    # Events are sorted by issuer and then by event type
    self.event_queue.sort(sort_fn=lambda event: self.ISSUER_PRIORITY[event[0]])

    events = self.event_queue.getAll(blocking=False)
    for event in events:
      issuer, event_type, event_data = event
      if issuer not in self.callbacks:
        print("Unhandled issuer: ", issuer)
        continue
      issuer_callbacks = self.callbacks[issuer]
      if event_type in issuer_callbacks:
        if event_data is not None:
          issuer_callbacks[event_type](event_data)
        else:
          issuer_callbacks[event_type]()
      else:
        print("Unhandled event: ", event)

