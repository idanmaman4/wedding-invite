"""Throwaway Postgres for the browser suite (run.mjs).

Starts a pgserver in the given directory, prints its URL on the first line of
stdout, and keeps it up until this process is terminated.
"""

import signal
import sys
import time

import pgserver

server = pgserver.get_server(sys.argv[1], cleanup_mode="delete")
print(server.get_uri(), flush=True)


def stop(*_):
    server.cleanup()
    sys.exit(0)


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
while True:
    time.sleep(3600)
