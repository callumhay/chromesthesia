import threading

class ItemStore(object):
  def __init__(self):
    self._condition_lock = threading.Condition()
    self.items = []

  def add(self, item):
    with self._condition_lock:
      self.items.append(item)
      self._condition_lock.notify_all()

  def getAll(self, blocking=False):
    with self._condition_lock:
      if blocking:
        while not self.items:
          self._condition_lock.wait()
      items, self.items = self.items, []
    return items
