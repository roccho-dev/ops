#define _POSIX_C_SOURCE 200809L
#include "cdp.h"
#include <curl/curl.h>
#include <json-c/json.h>
#include <errno.h>
#include <math.h>
#include <poll.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#define LIMIT (16u * 1024u * 1024u)
struct Cdp { CURL *curl; curl_socket_t socket; unsigned id; int broken;
    const volatile sig_atomic_t *cancel; };
typedef enum { METRICS, TREE, SHOT, MOUSE, KEYS, INSERT } Method;
/* The only wire method names. No generic passthrough API. */
static const char *const methods[] = { "Page.getLayoutMetrics", "Page.getFrameTree",
    "Page.captureScreenshot", "Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText" };
static int64_t now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec*1000LL+t.tv_nsec/1000000; }
static int cancelled(Cdp *c) { return c->cancel && *c->cancel; }
static int wait_socket(Cdp *c, short events, int64_t deadline) {
    while (!cancelled(c) && now() < deadline) {
        struct pollfd p = { c->socket, events, 0 };
        int r = poll(&p, 1, 50);
        if (r > 0) return (p.revents & events) ? 0 : -1;
        if (r < 0 && errno != EINTR) break;
    }
    return -1;
}
static json_object *get(json_object *o, const char *k) { json_object *v = NULL; json_object_object_get_ex(o, k, &v); return v; }
static json_object *receive(Cdp *c, int64_t end) {
    char *buf = malloc(LIMIT+1); size_t used = 0; json_object *result = NULL;
    if (!buf) return NULL;
    while (!cancelled(c) && now() < end && used < LIMIT) {
        size_t n = 0; const struct curl_ws_frame *meta = NULL;
        CURLcode r = curl_ws_recv(c->curl, buf+used, LIMIT-used, &n, &meta);
        if (r == CURLE_AGAIN) { if (wait_socket(c, POLLIN, end)) break; continue; }
        if (r != CURLE_OK || !meta || (meta->flags & CURLWS_CLOSE)) break;
        if (meta->flags & (CURLWS_PING | CURLWS_PONG)) continue;
        if (!(meta->flags & CURLWS_TEXT) || meta->bytesleft > (curl_off_t)(LIMIT-used-n)) break;
        used += n;
        if (meta->bytesleft || (meta->flags & CURLWS_CONT)) continue;
        if (!valid_utf8((const unsigned char *)buf, used)) break;
        buf[used] = 0;
        json_tokener *tok = json_tokener_new_ex(32);
        if (!tok) break;
        json_tokener_set_flags(tok, JSON_TOKENER_STRICT);
        result = json_tokener_parse_ex(tok, buf, (int)used);
        if (json_tokener_get_error(tok) != json_tokener_success ||
            json_tokener_get_parse_end(tok) != used || !json_object_is_type(result, json_type_object)) {
            json_object_put(result); result = NULL;
        }
        json_tokener_free(tok); break;
    }
    free(buf); return result;
}
static json_object *call(Cdp *c, Method method, json_object *params) {
    json_object *answer = NULL, *req = json_object_new_object();
    if (!req || !params || !c || c->broken || cancelled(c) || method < METRICS || method > INSERT) goto done;
    unsigned id = ++c->id;
    json_object_object_add(req, "id", json_object_new_int64(id));
    json_object_object_add(req, "method", json_object_new_string(methods[method]));
    json_object_object_add(req, "params", json_object_get(params));
    const char *data = json_object_to_json_string_ext(req, JSON_C_TO_STRING_PLAIN);
    size_t len = strlen(data), pos = 0;
    int64_t end = now()+3000;
    while (pos < len && !cancelled(c) && now() < end) {
        size_t n = 0;
        CURLcode r = curl_ws_send(c->curl, data+pos, len-pos, &n, 0, CURLWS_TEXT);
        if (r != CURLE_OK && r != CURLE_AGAIN) goto broken;
        pos += n;
        if (pos < len && wait_socket(c, POLLOUT, end)) goto broken;
    }
    if (pos != len) goto broken;
    for (unsigned events = 0; events < 1024 && now() < end; ++events) {
        json_object *msg = receive(c, end);
        if (!msg) goto broken;
        json_object *mid = get(msg, "id");
        if (mid) {
            if (!json_object_is_type(mid, json_type_int) || json_object_get_int64(mid) != id ||
                get(msg, "error") || !json_object_is_type(get(msg, "result"), json_type_object)) {
                json_object_put(msg); goto broken;
            }
            answer = json_object_get(get(msg, "result")); json_object_put(msg); goto done;
        }
        if (!json_object_is_type(get(msg, "method"), json_type_string)) { json_object_put(msg); goto broken; }
        json_object_put(msg); /* no event queue */
    }
broken:
    c->broken = 1;
done:
    json_object_put(req); json_object_put(params); return answer;
}
static int page_url(const char *url) {
    CURLU *u = curl_url(); char *scheme=NULL, *host=NULL, *path=NULL, *user=NULL, *fragment=NULL;
    int ok = 0;
    if (!u || curl_url_set(u, CURLUPART_URL, url, CURLU_NON_SUPPORT_SCHEME)) goto done;
    if (curl_url_get(u, CURLUPART_SCHEME, &scheme, 0) || curl_url_get(u, CURLUPART_HOST, &host, 0) ||
        curl_url_get(u, CURLUPART_PATH, &path, 0)) goto done;
    if (strcmp(scheme,"ws") && strcmp(scheme,"wss")) goto done;
    if (strcmp(host,"127.0.0.1") && strcmp(host,"[::1]")) goto done;
    if (!curl_url_get(u, CURLUPART_USER, &user, 0) || !curl_url_get(u, CURLUPART_FRAGMENT, &fragment, 0)) goto done;
    const char *prefix="/devtools/page/";
    if (strncmp(path,prefix,strlen(prefix))) goto done;
    const char *id=path+strlen(prefix); size_t n=strlen(id);
    ok = n>0 && n<=128 && strspn(id,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")==n;
done:
    curl_free(scheme); curl_free(host); curl_free(path); curl_free(user); curl_free(fragment); curl_url_cleanup(u); return ok;
}
int cdp_attach(Cdp **out, const char *url, const volatile sig_atomic_t *cancel) {
    *out = NULL;
    if (!url || !page_url(url)) return CDP_UNSUPPORTED;
    Cdp *c = calloc(1,sizeof(*c)); if (!c) return CDP_ERROR;
    c->cancel=cancel; c->curl=curl_easy_init();
    if (!c->curl) { free(c); return CDP_ERROR; }
    curl_easy_setopt(c->curl,CURLOPT_URL,url);
    curl_easy_setopt(c->curl,CURLOPT_CONNECT_ONLY,2L);
    curl_easy_setopt(c->curl,CURLOPT_CONNECTTIMEOUT_MS,3000L);
    curl_easy_setopt(c->curl,CURLOPT_TIMEOUT_MS,3000L);
    curl_easy_setopt(c->curl,CURLOPT_PROXY,"");
    curl_easy_setopt(c->curl,CURLOPT_FOLLOWLOCATION,0L);
    curl_easy_setopt(c->curl,CURLOPT_NOSIGNAL,1L);
    if (cancelled(c) || curl_easy_perform(c->curl) != CURLE_OK ||
        curl_easy_getinfo(c->curl,CURLINFO_ACTIVESOCKET,&c->socket) != CURLE_OK) {
        cdp_detach(c); return CDP_ERROR;
    }
    *out=c; return CDP_OK;
}
void cdp_detach(Cdp *c) { if (c) { curl_easy_cleanup(c->curl); free(c); } }
void frame_free(Frame *f) { free(f->png); free(f->geometry); memset(f,0,sizeof(*f)); }
int valid_utf8(const unsigned char *s, size_t n) {
    for (size_t i=0;i<n;) {
        unsigned v=s[i++], need=0, min=0;
        if (v<128) continue;
        if (v>=0xc2 && v<=0xdf) { need=1; min=0x80; v&=31; }
        else if (v>=0xe0 && v<=0xef) { need=2; min=0x800; v&=15; }
        else if (v>=0xf0 && v<=0xf4) { need=3; min=0x10000; v&=7; }
        else return 0;
        if (need>n-i) return 0;
        for (unsigned j=0;j<need;j++) { unsigned b=s[i++]; if ((b&0xc0)!=0x80) return 0; v=(v<<6)|(b&63); }
        if (v<min || v>0x10ffff || (v>=0xd800 && v<=0xdfff)) return 0;
    }
    return 1;
}
static int b64(char c) {
    if (c>='A' && c<='Z') return c-'A';
    if (c>='a' && c<='z') return c-'a'+26;
    if (c>='0' && c<='9') return c-'0'+52;
    if (c=='+') return 62;
    if (c=='/') return 63;
    return -1;
}
static int png_header(Frame *f) {
    if (f->len<44 || f->len%4) return -1;
    size_t pad=0; while (pad<2 && f->png[f->len-1-pad]=='=') pad++;
    for (size_t i=0;i<f->len-pad;i++) if (b64(f->png[i])<0) return -1;
    if (pad && (b64(f->png[f->len-pad-1]) & (pad==2 ? 15:3))) return -1;
    unsigned char bytes[24];
    for (size_t i=0,j=0;j<24;i+=4) {
        unsigned v=(unsigned)b64(f->png[i])<<18 | (unsigned)b64(f->png[i+1])<<12 |
            (unsigned)b64(f->png[i+2])<<6 | (unsigned)b64(f->png[i+3]);
        bytes[j++]=(unsigned char)(v>>16); bytes[j++]=(unsigned char)(v>>8); bytes[j++]=(unsigned char)v;
    }
    static const unsigned char header[]={137,80,78,71,13,10,26,10,0,0,0,13,'I','H','D','R'};
    if (memcmp(bytes,header,sizeof(header))) return -1;
    f->width=(uint32_t)bytes[16]<<24 | (uint32_t)bytes[17]<<16 | (uint32_t)bytes[18]<<8 | bytes[19];
    f->height=(uint32_t)bytes[20]<<24 | (uint32_t)bytes[21]<<16 | (uint32_t)bytes[22]<<8 | bytes[23];
    return !f->width || !f->height || (uint64_t)f->width*f->height>16000000 ? -1:0;
}
static json_object *geometry(Cdp *c) {
    json_object *metrics=call(c,METRICS,json_object_new_object());
    json_object *tree=call(c,TREE,json_object_new_object()), *result=NULL;
    json_object *v=get(metrics,"cssVisualViewport"), *l=get(metrics,"cssLayoutViewport");
    json_object *loader=get(get(get(tree,"frameTree"),"frame"),"loaderId");
    if (!json_object_is_type(v,json_type_object) || !json_object_is_type(l,json_type_object) ||
        !json_object_is_type(loader,json_type_string)) goto done;
    const char *numbers[]={"clientWidth","clientHeight","pageX","pageY","offsetX","offsetY","scale"};
    for (size_t i=0;i<sizeof(numbers)/sizeof(*numbers);i++) {
        json_object *n=get(v,numbers[i]);
        if ((!json_object_is_type(n,json_type_double) && !json_object_is_type(n,json_type_int)) ||
            !isfinite(json_object_get_double(n))) goto done;
    }
    double w=json_object_get_double(get(v,"clientWidth")), h=json_object_get_double(get(v,"clientHeight"));
    if (w<=0 || h<=0 || w>32768 || h>32768 || json_object_get_double(get(v,"scale"))!=1 ||
        json_object_get_double(get(v,"offsetX"))!=0 || json_object_get_double(get(v,"offsetY"))!=0) goto done;
    result=json_object_new_object();
    json_object_object_add(result,"visual",json_object_get(v));
    json_object_object_add(result,"layout",json_object_get(l));
    json_object_object_add(result,"loader",json_object_get(loader));
done:
    json_object_put(metrics); json_object_put(tree); return result;
}
int cdp_frame(Cdp *c, Frame *out) {
    memset(out,0,sizeof(*out));
    json_object *before=geometry(c), *shot=NULL, *after=NULL;
    int status=CDP_ERROR;
    if (!before) goto done;
    json_object *p=json_object_new_object();
    json_object_object_add(p,"format",json_object_new_string("png"));
    json_object_object_add(p,"captureBeyondViewport",json_object_new_boolean(0));
    /* Explicit CSS viewport clip excludes scrollbars; never resize the page. */
    json_object *clip=json_object_new_object(), *view=get(before,"visual");
    json_object_object_add(clip,"x",json_object_get(get(view,"pageX")));
    json_object_object_add(clip,"y",json_object_get(get(view,"pageY")));
    json_object_object_add(clip,"width",json_object_get(get(view,"clientWidth")));
    json_object_object_add(clip,"height",json_object_get(get(view,"clientHeight")));
    json_object_object_add(clip,"scale",json_object_new_double(1));
    json_object_object_add(p,"clip",clip);
    shot=call(c,SHOT,p); after=geometry(c);
    if (!after) goto done;
    if (!json_object_equal(before,after)) { status=CDP_STALE; goto done; }
    json_object *data=get(shot,"data");
    if (!json_object_is_type(data,json_type_string)) goto done;
    out->len=(size_t)json_object_get_string_len(data);
    out->png=strdup(json_object_get_string(data));
    out->geometry=strdup(json_object_to_json_string_ext(after,JSON_C_TO_STRING_PLAIN));
    out->css_width=json_object_get_double(get(get(after,"visual"),"clientWidth"));
    out->css_height=json_object_get_double(get(get(after,"visual"),"clientHeight"));
    if (!out->png || !out->geometry || strlen(out->png)!=out->len || png_header(out)) goto done;
    status=CDP_OK;
done:
    json_object_put(before); json_object_put(shot); json_object_put(after);
    if (status!=CDP_OK) frame_free(out);
    return status;
}
int frame_equal(const Frame *a, const Frame *b) {
    return a && b && a->png && b->png && a->geometry && b->geometry && a->len==b->len &&
        !strcmp(a->geometry,b->geometry) && !memcmp(a->png,b->png,a->len);
}
static int effect(Cdp *c, Method m, json_object *p) { json_object *r=call(c,m,p); int s=r ? CDP_OK:CDP_ERROR; json_object_put(r); return s; }
int cdp_apply(Cdp *c, const Frame *shown, const Action *a) {
    if (!c || !shown || !shown->png || !a || a->kind<TEXT || a->kind>WHEEL) return CDP_UNSUPPORTED;
    if (a->kind==TEXT && (!a->text || strlen(a->text)>4096 || !valid_utf8((const unsigned char *)a->text,strlen(a->text)))) return CDP_UNSUPPORTED;
    if (a->kind==KEY && (a->key<ENTER || a->key>SELECT_ALL)) return CDP_UNSUPPORTED;
    if ((a->kind==CLICK || a->kind==WHEEL) && (!isfinite(a->x) || !isfinite(a->y) || !isfinite(a->delta) ||
        a->x<0 || a->y<0 || a->x>=shown->css_width || a->y>=shown->css_height || a->button<0 || a->button>2 || fabs(a->delta)>1000)) return CDP_UNSUPPORTED;
    Frame fresh; int s=cdp_frame(c,&fresh); if (s) return s;
    int same=frame_equal(shown,&fresh); frame_free(&fresh); if (!same) return CDP_STALE;
    json_object *p=json_object_new_object();
    if (a->kind==TEXT) {
        json_object_object_add(p,"text",json_object_new_string(a->text)); return effect(c,INSERT,p);
    }
    if (a->kind==KEY) {
        static const char *const names[]={"Enter","Tab","Backspace","Delete","Escape","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Home","End","a"};
        static const int vk[]={13,9,8,46,27,37,39,38,40,36,35,65};
        json_object_object_add(p,"key",json_object_new_string(names[a->key]));
        json_object_object_add(p,"windowsVirtualKeyCode",json_object_new_int(vk[a->key]));
        json_object_object_add(p,"modifiers",json_object_new_int(a->key==SELECT_ALL ? 2:0));
        json_object_object_add(p,"type",json_object_new_string("keyDown"));
        if (effect(c,KEYS,json_object_get(p))) { json_object_put(p); return CDP_ERROR; }
        json_object_object_add(p,"type",json_object_new_string("keyUp")); return effect(c,KEYS,p);
    }
    json_object_object_add(p,"x",json_object_new_double(a->x)); json_object_object_add(p,"y",json_object_new_double(a->y));
    if (a->kind==WHEEL) {
        json_object_object_add(p,"type",json_object_new_string("mouseWheel"));
        json_object_object_add(p,"deltaX",json_object_new_double(0)); json_object_object_add(p,"deltaY",json_object_new_double(a->delta));
        return effect(c,MOUSE,p);
    }
    static const char *const buttons[]={"left","middle","right"};
    json_object_object_add(p,"button",json_object_new_string(buttons[a->button]));
    json_object_object_add(p,"clickCount",json_object_new_int(1));
    json_object_object_add(p,"buttons",json_object_new_int(a->button==0 ? 1 : a->button==1 ? 4 : 2));
    json_object_object_add(p,"type",json_object_new_string("mousePressed"));
    if (effect(c,MOUSE,json_object_get(p))) { json_object_put(p); return CDP_ERROR; }
    json_object_object_add(p,"buttons",json_object_new_int(0));
    json_object_object_add(p,"type",json_object_new_string("mouseReleased")); return effect(c,MOUSE,p);
}
