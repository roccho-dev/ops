#define _POSIX_C_SOURCE 200809L
#include "cdp.h"
#include <curl/curl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
/* Test-only second caller: links the actual library, never spawns the CLI. */
int main(int argc,char **argv) {
    if (argc!=2 || curl_global_init(CURL_GLOBAL_DEFAULT)) return 1;
    setvbuf(stdout,NULL,_IOLBF,0);
    volatile sig_atomic_t cancel=0;
    Cdp *c=NULL; Frame f={0}; int r=cdp_attach(&c,argv[1],&cancel);
    printf("%d\n",r); if (r) { curl_global_cleanup(); return 0; }
    char line[5000];
    while (fgets(line,sizeof(line),stdin)) {
        line[strcspn(line,"\n")]=0;
        if (!strcmp(line,"quit")) break;
        if (!strcmp(line,"frame")) {
            frame_free(&f); r=cdp_frame(c,&f);
            printf("%d %u %u %.6f %.6f\n",r,f.width,f.height,f.css_width,f.css_height); continue;
        }
        if (!strcmp(line,"cancel")) { cancel=1; Frame t; r=cdp_frame(c,&t); frame_free(&t); printf("%d\n",r); continue; }
        Action a={0};
        if (!strncmp(line,"text ",5)) { a.kind=TEXT; a.text=line+5; }
        else if (!strncmp(line,"click ",6)) { a.kind=CLICK; if (sscanf(line+6,"%lf %lf %d",&a.x,&a.y,&a.button)!=3) return 2; }
        else if (!strncmp(line,"wheel ",6)) { a.kind=WHEEL; if (sscanf(line+6,"%lf %lf %lf",&a.x,&a.y,&a.delta)!=3) return 2; }
        else if (!strncmp(line,"key ",4)) { a.kind=KEY; a.key=(Key)strtol(line+4,NULL,10); }
        else a.kind=(ActionKind)99;
        printf("%d\n",cdp_apply(c,&f,&a));
    }
    frame_free(&f); cdp_detach(c); curl_global_cleanup(); return 0;
}
