export const JEV_MODEL = 'jev-1.13.0';

export function validateJevBudget(state, questions) {
  const stateBytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
  const questionValues = Object.values(questions ?? {});
  const questionBytes = questionValues.map((question) => Buffer.byteLength(JSON.stringify(question), 'utf8'));
  const longestQuestionBytes = questionBytes.length === 0 ? 0 : Math.max(...questionBytes);
  const allQuestionsBytes = questionBytes.reduce((sum, value) => sum + value, 0);
  if (stateBytes > 28000) throw new Error(`Jev state budget exceeded: ${stateBytes} bytes`);
  if (stateBytes + longestQuestionBytes > 31000) throw new Error(`Jev state+question budget exceeded: ${stateBytes + longestQuestionBytes} bytes`);
  if (stateBytes + allQuestionsBytes > 60000) throw new Error(`Jev request budget exceeded: ${stateBytes + allQuestionsBytes} bytes`);
  return { stateBytes, longestQuestionBytes, allQuestionsBytes };
}
