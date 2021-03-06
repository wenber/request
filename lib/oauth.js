'use strict'

var qs = require('qs')
  , caseless = require('caseless')
  , uuid = require('node-uuid')
  , oauth = require('oauth-sign')
  , crypto = require('crypto')


function OAuth (request) {
  this.request = request
}

OAuth.prototype.buildParams = function (_oauth, uri, method, query, form, qsLib) {
  var oa = {}
  for (var i in _oauth) {
    oa['oauth_' + i] = _oauth[i]
  }
  if (!oa.oauth_version) {
    oa.oauth_version = '1.0'
  }
  if (!oa.oauth_timestamp) {
    oa.oauth_timestamp = Math.floor( Date.now() / 1000 ).toString()
  }
  if (!oa.oauth_nonce) {
    oa.oauth_nonce = uuid().replace(/-/g, '')
  }
  if (!oa.oauth_signature_method) {
    oa.oauth_signature_method = 'HMAC-SHA1'
  }

  var consumer_secret_or_private_key = oa.oauth_consumer_secret || oa.oauth_private_key
  delete oa.oauth_consumer_secret
  delete oa.oauth_private_key

  var token_secret = oa.oauth_token_secret
  delete oa.oauth_token_secret

  var realm = oa.oauth_realm
  delete oa.oauth_realm
  delete oa.oauth_transport_method

  var baseurl = uri.protocol + '//' + uri.host + uri.pathname
  var params = qsLib.parse([].concat(query, form, qsLib.stringify(oa)).join('&'))

  oa.oauth_signature = oauth.sign(
    oa.oauth_signature_method,
    method,
    baseurl,
    params,
    consumer_secret_or_private_key,
    token_secret)

  if (realm) {
    oa.realm = realm
  }

  return oa
}

OAuth.prototype.buildBodyHash = function(_oauth, body) {
  if (['HMAC-SHA1', 'RSA-SHA1'].indexOf(_oauth.signature_method || 'HMAC-SHA1') < 0) {
    throw new Error('oauth: ' + _oauth.signature_method + ' signature_method not supported with body_hash signing.')
  }

  var shasum = crypto.createHash('sha1')
  shasum.update(body || '')
  var sha1 = shasum.digest('hex')

  return new Buffer(sha1).toString('base64')
}

OAuth.prototype.concatParams = function (oa, sep, wrap) {
  wrap = wrap || ''

  var params = Object.keys(oa).filter(function (i) {
    return i !== 'realm' && i !== 'oauth_signature'
  }).sort()

  if (oa.realm) {
    params.splice(0, 1, 'realm')
  }
  params.push('oauth_signature')

  return params.map(function (i) {
    return i + '=' + wrap + oauth.rfc3986(oa[i]) + wrap
  }).join(sep)
}

OAuth.prototype.onRequest = function (_oauth) {
  var self = this
    , request = self.request

  var uri = request.uri || {}
    , method = request.method || ''
    , headers = caseless(request.headers)
    , body = request.body || ''
    , qsLib = request.qsLib || qs

  var form
    , query
    , contentType = headers.get('content-type') || ''
    , formContentType = 'application/x-www-form-urlencoded'
    , transport = _oauth.transport_method || 'header'

  if (contentType.slice(0, formContentType.length) === formContentType) {
    contentType = formContentType
    form = body
  }
  if (uri.query) {
    query = uri.query
  }
  if (transport === 'body' && (method !== 'POST' || contentType !== formContentType)) {
    throw new Error('oauth: transport_method of \'body\' requires \'POST\' ' +
      'and content-type \'' + formContentType + '\'')
  }

  if (!form && typeof _oauth.body_hash === 'boolean') {
    _oauth.body_hash = this.buildBodyHash(_oauth, this.request.body.toString())
  }

  var oa = this.buildParams(_oauth, uri, method, query, form, qsLib)

  switch (transport) {
    case 'header':
      request.setHeader('Authorization', 'OAuth ' + this.concatParams(oa, ',', '"'))
      break

    case 'query':
      request.path = (query ? '&' : '?') + this.concatParams(oa, '&')
      break

    case 'body':
      request.body = (form ? form + '&' : '') + this.concatParams(oa, '&')
      break

    default:
      throw new Error('oauth: transport_method invalid')
  }
}

exports.OAuth = OAuth
