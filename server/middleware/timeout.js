/**
 * Request/response timeout middleware — 60 seconds (prevents hanging on slow queries)
 */
module.exports = (req, res, next) => {
    req.setTimeout(60000);
    res.setTimeout(60000);
    next();
};
