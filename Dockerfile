# One small image: the Python server, and the page it serves.
# The server uses the standard library only, so there is nothing to install.
FROM python:3.13-alpine

WORKDIR /app
COPY server/ server/
COPY web/ web/

ENV PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    PORT=8000

# Run as a normal user, not root. /data keeps the cache, the styles and the covers.
# The code stays owned by root but readable by everyone, whatever the permissions of the copy.
RUN adduser -D app && mkdir -p /data && chown app /data && chmod -R a+rX /app
USER app

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8000/api/health || exit 1
CMD ["python", "server/app.py"]
