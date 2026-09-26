CC ?= cc
CFLAGS ?= -O2 -g
CFLAGS += -std=c11 -Wall -Wextra -Werror -Wpedantic
CPPFLAGS += $(shell pkg-config --cflags libcurl json-c)
LDLIBS += $(shell pkg-config --libs libcurl json-c) -lm
all: cdp-tty libcdp-tty.a
cdp-tty: main.o tty.o libcdp-tty.a
	$(CC) $(CFLAGS) -o $@ main.o tty.o libcdp-tty.a $(LDLIBS)
libcdp-tty.a: cdp.o
	$(AR) rcs $@ cdp.o
main.o tty.o: tty.h
main.o tty.o cdp.o: cdp.h
probe: tests/probe.c libcdp-tty.a
	$(CC) $(CPPFLAGS) $(CFLAGS) -I. -o $@ tests/probe.c libcdp-tty.a $(LDLIBS)
check: all probe
	CDP_TTY_PACKAGE="$(CURDIR)" python3 ../../verification/cdp-tty/proof.py
clean:
	rm -f *.o *.a cdp-tty probe
.PHONY: all check clean
