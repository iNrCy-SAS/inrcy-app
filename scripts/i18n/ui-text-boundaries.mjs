import ts from "typescript";

/** Follow only rendered branches; conditions, class names and translation keys are not copy. */
export function directConditionalUiLiteral(node, isUiAttribute) {
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isJsxExpression(parent)) {
      return !ts.isJsxAttribute(parent.parent) || isUiAttribute(parent.parent.name.getText());
    }
    if (ts.isParenthesizedExpression(parent)) { current = parent; continue; }
    if (ts.isConditionalExpression(parent) && (parent.whenTrue === current || parent.whenFalse === current)) {
      current = parent; continue;
    }
    if (ts.isBinaryExpression(parent) && parent.right === current &&
      [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(parent.operatorToken.kind)) {
      current = parent; continue;
    }
    return false;
  }
  return false;
}
