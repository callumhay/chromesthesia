import multiprocessing

class ItemStore(object):
  def __init__(self):
    self._condition_lock = multiprocessing.Condition()
    self._items = []

  def add(self, item):
    with self._condition_lock:
      self._items.append(item)
      self._condition_lock.notify_all()

  def sort(self, sort_fn, reverse=False):
    with self._condition_lock:
      self._items.sort(key=sort_fn, reverse=reverse)

  def getAll(self, blocking=False):
    with self._condition_lock:
      if blocking:
        while not self._items:
          self._condition_lock.wait()
      items, self._items = self._items, []
    return items
