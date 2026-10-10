import {question,projectBody,classify} from '../../sys1-eval-loop/split.mjs';
export function issueCore(candidate) {
  return {id:'issue-state-separation/body-role',labels:['ok','body_observation','expectation_missing','unknown','not_applicable'],
    when:'Issue本文の期待宣言と観測の分離を確認する',
    async run(input,model) {
      if(input.purpose==='historical-record')return {label:'not_applicable',source:'declared-input'};
      if(input.complete===false)return {label:'unknown',source:'declared-input'};
      const request=projectBody({text:JSON.stringify(input),instructions:candidate.instructions});
      const e=await model.which(question(request,'E')),o=await model.which(question(request,'O'));
      return {label:classify(e.label,o.label),source:'model',axes:{E:e.label,O:o.label}};
    }};
}
