#define _POSIX_C_SOURCE 200809L
#include "tty.h"
#include <curl/curl.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
static volatile sig_atomic_t stop;
static void cancel(int sig) { (void)sig; stop=1; }
int main(int argc, char **argv) {
    int observe=argc==3 && !strcmp(argv[1],"--observe");
    if (argc==2 && !strcmp(argv[1],"--help")) {
        puts("cdp-tty [--observe] ws://127.0.0.1:PORT/devtools/page/ID\nLinux + Kitty graphics terminal; Ctrl-Q exits. No browser launch or automatic reconnect."); return 0;
    }
    if (argc!=2 && !observe) { fputs("cdp-tty: expected one explicit loopback page WebSocket URL\n",stderr); return 2; }
    struct sigaction sa={0}; sa.sa_handler=cancel; sigemptyset(&sa.sa_mask);
    sigaction(SIGINT,&sa,NULL); sigaction(SIGTERM,&sa,NULL); sigaction(SIGHUP,&sa,NULL);
    sa.sa_handler=SIG_IGN; sigaction(SIGPIPE,&sa,NULL);
    if (curl_global_init(CURL_GLOBAL_DEFAULT)) return 1;
    Cdp *c=NULL; int r=cdp_attach(&c,argv[observe ? 2:1],&stop);
    if (!r) r=tty_run(c,observe,&stop);
    cdp_detach(c); curl_global_cleanup();
    if (r) fputs("cdp-tty: connection, terminal or frame rejected; no input replay; see supported scope\n",stderr);
    return r ? 1:0;
}
