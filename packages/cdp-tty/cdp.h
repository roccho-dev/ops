#ifndef CDP_TTY_H
#define CDP_TTY_H
#include <signal.h>
#include <stddef.h>
#include <stdint.h>

/* Sequential, caller-owned connection. No global signal/TTY/process ownership. */
typedef struct Cdp Cdp;
typedef struct {
    char *png; size_t len;
    char *geometry;
    uint32_t width, height;
    double css_width, css_height;
} Frame;
typedef enum { TEXT, KEY, CLICK, WHEEL } ActionKind;
typedef enum { ENTER, TAB, BACKSPACE, DELETE_KEY, ESCAPE, LEFT, RIGHT, UP, DOWN, HOME, END, SELECT_ALL } Key;
typedef struct {
    ActionKind kind;
    const char *text;
    Key key;
    double x, y, delta;
    int button; /* 0 left, 1 middle, 2 right */
} Action;
enum { CDP_OK = 0, CDP_ERROR = 1, CDP_STALE = 2, CDP_UNSUPPORTED = 3 };
int cdp_attach(Cdp **out, const char *page_ws, const volatile sig_atomic_t *cancel);
void cdp_detach(Cdp *c);
int cdp_frame(Cdp *c, Frame *out);
void frame_free(Frame *f);
/* Reject changed pixels/geometry before input. Not an atomic page lock. */
int cdp_apply(Cdp *c, const Frame *shown, const Action *action);
int frame_equal(const Frame *a, const Frame *b);
int valid_utf8(const unsigned char *s, size_t n);
#endif
