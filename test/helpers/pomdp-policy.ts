/** Alpha-policy XML and SARSOP log fixtures for the verification-policy research suites. */

/** One alpha vector per entry: [zero-based action, one value for every state or one value per state]. */
export function policyXml(states: number, vectors: Array<[number, number | number[]]>): string {
  return `<Policy><AlphaVector vectorLength="${states}" numObsValue="1" numVectors="${vectors.length}">${vectors.map(([action, value]) =>
    `<Vector action="${action}" obsValue="0">${(Array.isArray(value) ? value : Array(states).fill(value)).join(' ')}</Vector>`).join('')}</AlphaVector></Policy>`;
}

/** A SARSOP progress table whose last row brackets `value` (a cost) within 0.0001. */
export function solverLogFor(value: number): string {
  return ` Time |#Trial |#Backup |LBound |UBound |Precision |#Alphas |#Beliefs\n 0.25 14 230 ${-value - 0.0001} ${-value} 0.0001 20 80\n`;
}
