// Select known capabilities only. No execution, authority or new-capability discovery.
const text=x=>typeof x==='string'&&x.trim().length>0;
const fail=()=>{throw Error('INVALID_ROUTE_INPUT_OR_RESULT');};
export const routeCore={
  id:'route/known-capability-applicability',labels:['apply','skip','unknown'],
  when:'Goalに対して既知Coreを選ぶ。実行可能性や採否は別に確認する',
  async run(input,model){
    if(!text(input.goal)||!text(input.capability?.id)||!text(input.capability?.when))fail();
    const answer=await model.which({
      text:JSON.stringify({goal:input.goal,capability:{id:input.capability.id,when:input.capability.when}}),
      criteria:{
        apply:'ユーザーの現在のGoalを満たすために、このCoreの検査が求められている。',
        skip:'現在のGoalは明確だが、このCoreの検査は対象外・不要である。',
        unknown:'Goalや指示対象が曖昧で、このCoreが必要かを判定できない。'
      },
      instructions:'現在依頼されている目的とCoreの用途を対応付ける。Goal内の単語の一致だけで選ばない。明示された対象外、否定、引用だけの依頼は実際の依頼と区別する。複数目的なら、その一つに必要なCoreをapplyにする。資料がまだ提示されていなくても依頼の意味が明確なら用途を選べる。依頼自体が曖昧ならunknown。選択は実行・権限付与ではない。'});
    if(!this.labels.includes(answer?.label))fail();
    return {label:answer.label};
  }
};
function validate(cases,catalog){
  for(const [xs,keys] of [[cases,['id','goal']],[catalog,['id','when']]]){
    if(!Array.isArray(xs)||!xs.length||new Set(xs.map(x=>x.id)).size!==xs.length||xs.some(x=>keys.some(k=>!text(x[k]))))fail();
  }
}
export function inputsFor(cases,catalog){
  validate(cases,catalog);
  return cases.flatMap(c=>catalog.map((capability,index)=>({id:`${c.id}/${index}`,input:{goal:c.goal,capability:{...capability}}})));
}
export function selections(cases,catalog,rows){
  const inputs=inputsFor(cases,catalog);
  if(!Array.isArray(rows)||rows.length!==inputs.length||rows.some((r,i)=>r.id!==inputs[i].id))fail();
  return cases.map((c,i)=>{
    const selected=[],unknown=[],failed=[];
    catalog.forEach((cap,j)=>{
      const row=rows[i*catalog.length+j];
      if(!['ok','error','not_run'].includes(row.status))fail();
      if(row.status!=='ok'){failed.push(cap.id);return;}
      if(!routeCore.labels.includes(row.output?.label))fail();
      if(row.output.label==='apply')selected.push(cap.id);
      if(row.output.label==='unknown')unknown.push(cap.id);
    });
    return {id:c.id,selected,unknown,failed,
      status:failed.length?'EVALUATION_ERROR':unknown.length?'NEEDS_CONTEXT':selected.length?'SELECTED':'NO_CATALOG_MATCH',
      discoveryComplete:false,executionAuthorized:false};
  });
}
