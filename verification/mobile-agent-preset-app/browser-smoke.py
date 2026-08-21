#!/usr/bin/env python3
from __future__ import annotations
import json, os, pathlib, sys
from playwright.sync_api import sync_playwright

def invariant(value, message):
    if not value: raise RuntimeError(f'mobile-agent-preset-browser: {message}')

def wait_ready(page):
    page.wait_for_function('globalThis.semanticMapSite?.ready === true', timeout=75000)
    page.wait_for_function('globalThis.semanticMapApp?.ready === true', timeout=75000)
    page.wait_for_function('globalThis.semanticMapRuntime?.view?.pattern', timeout=75000)

def main(argv):
    invariant(len(argv)==4,'expected urls.json receipt screenshots-dir')
    values=json.load(open(argv[1],encoding='utf-8')); receipt_path=pathlib.Path(argv[2]); shots=pathlib.Path(argv[3]); shots.mkdir(parents=True,exist_ok=True)
    results=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ['CHROME_BIN'],headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        try:
            for item in values['cases']:
                page=browser.new_page(viewport={'width':1280,'height':900})
                errors=[]; failed=[]
                page.on('pageerror',lambda error: errors.append(str(error)))
                page.on('console',lambda msg: errors.append(msg.text) if msg.type=='error' else None)
                page.on('response',lambda response: failed.append({'status':response.status,'url':response.url}) if response.status>=400 and not response.url.endswith('/favicon.ico') else None)
                page.goto(item['url'],wait_until='networkidle',timeout=75000); wait_ready(page)
                state=page.evaluate('''() => ({
                  pattern: semanticMapRuntime.view.pattern,
                  scene: semanticMapApp.snapshot().scene,
                  svg: Boolean(document.querySelector('#graph-container svg')),
                  graph: Boolean(semanticMapApp.adapter?.graph),
                  controls: ['pattern-select','add-node','undo','redo','delete','source-open','handoff-fab','review-layer'].map(id=>({id,present:Boolean(document.getElementById(id))})),
                  sourceReady: semanticMapSource?.ready===true,
                  handoffReady: semanticMapHandoff?.ready===true,
                  reviewReady: semanticMapReview?.ready===true,
                  envelope: semanticMapRuntime.envelope(),
                  camera: semanticMapApp.snapshot().camera,
                })''')
                invariant(state['pattern']==item['view']['pattern'],f"{item['id']}: pattern")
                invariant(state['scene']['pattern']==item['view']['pattern'],f"{item['id']}: scene")
                invariant(state['svg'] and state['graph'],f"{item['id']}: maxGraph")
                invariant(all(c['present'] for c in state['controls']),f"{item['id']}: controls {state['controls']}")
                invariant(state['sourceReady'] and state['handoffReady'] and state['reviewReady'],f"{item['id']}: shells")
                for label in item['labels']:
                    invariant(label in page.locator('body').inner_text(),f"{item['id']}: label {label}")
                interaction={}
                if item['id']=='graph':
                    interaction=page.evaluate('''async () => {
                      const region=[...semanticMapApp.store.domain.regions.values()].find(value=>value.parent!==null);
                      const cell=semanticMapApp.adapter.cellsByRegionId.get(region.id);
                      const before={...semanticMapApp.store.domain.regions.get(region.id).bounds};
                      const [{default:EventObject},{default:InternalEvent}]=await Promise.all([
                        import('semantic:vendor/maxgraph/view/event/EventObject.js'),
                        import('semantic:vendor/maxgraph/view/event/InternalEvent.js'),
                      ]);
                      semanticMapApp.adapter.graph.fireEvent(new EventObject(InternalEvent.CELLS_MOVED,{cells:[cell],dx:40,dy:0,disconnect:false}));
                      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
                      const moved={...semanticMapApp.store.domain.regions.get(region.id).bounds};
                      const draft=semanticMapRuntime.draftCount();
                      semanticMapApp.undo(); const undone={...semanticMapApp.store.domain.regions.get(region.id).bounds};
                      semanticMapApp.redo(); const redone={...semanticMapApp.store.domain.regions.get(region.id).bounds};
                      return {before,moved,undone,redone,draft};
                    }''')
                    invariant(interaction['moved']['x']!=interaction['before']['x'], 'graph: drag')
                    invariant(interaction['undone']==interaction['before'], 'graph: undo')
                    invariant(interaction['redone']==interaction['moved'], 'graph: redo')
                elif item['id']=='map':
                    interaction=page.evaluate('''() => { const before=semanticMapApp.snapshot().camera; semanticMapApp.zoomAtWorld(0,0,before.scale*1.25); const after=semanticMapApp.snapshot().camera; return {before,after}; }''')
                    invariant(interaction['after']['scale']>interaction['before']['scale'],'map: zoom')
                elif item['id']=='seq':
                    interaction=page.evaluate('''() => { const region=[...semanticMapApp.store.domain.regions.values()].find(value=>value.parent!==null); const before=region.label; semanticMapApp.operation({type:'RenameRegion',regionId:region.id,label:`${before} proof`}); const changed=semanticMapApp.store.domain.regions.get(region.id).label; semanticMapApp.undo(); const restored=semanticMapApp.store.domain.regions.get(region.id).label; return {before,changed,restored}; }''')
                    invariant(interaction['changed']!=interaction['before'],'seq: edit')
                    invariant(interaction['restored']==interaction['before'],'seq: undo')
                exported=page.evaluate('''async () => { const state=await semanticMapSource.render('state'); return {schema:state.schema,bytes:state.bytes,text:state.text}; }''')
                invariant(exported['bytes']>0 and exported['text'].strip(),f"{item['id']}: source export")
                decoded=state['envelope']; invariant(decoded['view']['pattern']==item['view']['pattern'],f"{item['id']}: envelope")
                page.screenshot(path=str(shots/f"{item['id']}.png"),full_page=True)
                invariant(errors==[],f"{item['id']}: browser errors {errors}")
                invariant(failed==[],f"{item['id']}: failed responses {failed}")
                results.append({'id':item['id'],'status':'PASS','pattern':state['pattern'],'maxGraph':True,'controls':state['controls'],'interaction':interaction,'sourceExportBytes':exported['bytes'],'url':item['url'],'browserErrors':0,'failedResponses':0})
                page.close()
        finally:
            browser.close()
    receipt={'schema':'ops.mobileAgentPresetBrowserProof/1','status':'PASS','authority':False,'cases':results}
    receipt_path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2,sort_keys=True)+'\n')
    print(json.dumps({'status':'PASS','cases':[{'id':x['id'],'pattern':x['pattern']} for x in results]}))
if __name__=='__main__': main(sys.argv)
