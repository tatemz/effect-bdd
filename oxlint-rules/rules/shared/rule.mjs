export const createRule = ({ description, messages, schema = [], create }) => ({
  meta: {
    type: "problem",
    docs: { description },
    messages,
    schema,
  },
  create,
});

export const report = (context, node, messageId) => {
  context.report({ node, messageId });
};
