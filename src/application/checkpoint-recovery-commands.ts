/** Existing operator paperwork for a retained locked-contract stop; no automatic dispatch. */
export function invalidContractRecoveryCommands(name: string): readonly string[] {
  return [
    `px checkpoint read --name ${name}`,
    `px checkpoint correct-invalid-contract --name ${name} --operator <name> --decision <correction> --evidence <reference>`,
    `px checkpoint record --name ${name} --force --criterion <exact-criterion> --evidence <reference> --next <next-action>`,
  ];
}
