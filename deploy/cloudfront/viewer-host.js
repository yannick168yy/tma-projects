function handler(event) {
  var request = event.request;
  var host = request.headers.host;
  if (host) {
    request.headers['x-viewer-host'] = { value: host.value };
  }
  return request;
}
