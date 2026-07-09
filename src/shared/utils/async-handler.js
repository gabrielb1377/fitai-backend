function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    Promise.resolve()
      .then(() => handler(req, res, next))
      .catch(next);
  };
}

module.exports = asyncHandler;
