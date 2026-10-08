/** Present recorded agent output as readable text without changing its evidence. */
export interface RecordedOutputRenderer {
  render(_family: string, _text: string): string;
}
