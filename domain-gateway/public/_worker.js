// Pages accepts externally managed CNAMEs; Workers Custom Domains require an
// active zone. Forward internally so the app receives the original public URL,
// cookies, request body and Origin header, including for server functions.
export default {
  fetch(request, env) {
    return env.KANI_APP.fetch(request);
  },
};
