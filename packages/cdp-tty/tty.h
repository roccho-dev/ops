#ifndef CDP_TTY_TERMINAL_H
#define CDP_TTY_TERMINAL_H
#include "cdp.h"
int tty_run(Cdp *c, int observe, const volatile sig_atomic_t *cancel);
#endif
