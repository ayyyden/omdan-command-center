// "No Answer" follow-up text for Meta Lead Jobs — copied to the employee's
// clipboard the first time a lead is marked No Answer, so it can be pasted
// straight into a Google Voice message.

export function buildNoAnswerSms(fullName: string): string {
  const firstName = fullName.split(" ")[0]
  return `Hi ${firstName}, thank you for reaching out! We tried giving you a call but weren't able to connect. We'd be happy to arrange a free, no-obligation on-site estimate to review your project, discuss design and material options, and provide accurate pricing. Feel free to call or text us back whenever it's convenient—we'd love to help bring your ideas to life.`
}
