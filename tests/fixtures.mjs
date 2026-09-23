export const mixed = { state: { issue: 'synthetic failure' }, questions: {
  yes: { type: 'noul', instructions: 'Is it broken?', criteria: { true: 'Broken', false: 'Working' } },
  route: { type: 'choice', instructions: 'Choose a team', criteria: { a: 'Team A', b: 'Team B' } },
  impact: { type: 'score', instructions: 'Rate impact', criteria: ['Low', 'High'] }
} };
export const response = { model: 'jev-1.13.0', answers: {
  yes: { type: 'noul', noul: 0.8 },
  route: { type: 'choice', choice: 'a', probabilities: { a: 0.6, b: 0.4 }, confidence: 0.2 },
  impact: { type: 'score', score: 0.25, legend: { 0: 'Low', 1: 'High' }, probabilities: { 0: 0.75, 1: 0.25 }, confidence: 0.5 }
}, usage: { input_tokens: 4, output_tokens: 2 } };
