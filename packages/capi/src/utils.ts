import crypto from 'crypto';
import moment from 'moment';
import chalk from 'chalk';
import dotQs from 'dot-qs';
import qs from 'querystring';
import { CapiOptions } from './index';

export interface Payload {
  Region?: string;
  SecretId?: string;
  Timestamp?: number | string;
  Nonce?: number;
  [propName: string]: any;
}

export interface HostParams {
  ServiceType: string;
  Region: string;
  host: string | undefined;
  baseHost: string | undefined;
  path?: string;
  protocol?: string;
}

export interface TencentSignResult {
  url: string;
  payload: Payload;
  Host: string;
  Authorization: string;
  Timestamp: number | string;
}

export interface TencentSignResultV1 {
  url: string;
  method: string;
  signPath: string;
}

export function logger(topic: string, content: string): void {
  console.log(
    `${chalk.black.bgYellow('[DEBUG]')} ${chalk.green(
      `${topic}:`,
    )} ${content} `,
  );
}

export function getHost(
  { host, ServiceType, Region, baseHost }: HostParams,
  isV1 = false,
) {
  if (!host) {
    host = `${ServiceType}${isV1 ? '' : `.${Region}`}.${baseHost}`;
  }
  return host;
}

export function getUrl(opts: HostParams, isV1 = false) {
  opts = opts || {};
  const host = getHost(opts, isV1);
  const path = opts.path || '/';

  return `${opts.protocol || 'https'}://${host}${path}`;
}

export function sign(
  str: string,
  secretKey: Buffer,
  algorithm: string = 'sha256',
): Buffer {
  const hmac = crypto.createHmac(algorithm, secretKey);
  return hmac.update(Buffer.from(str, 'utf8')).digest();
}

/**
 * generate tencent cloud sign result
 *
 * @param {Payload} payload
 * @param {CapiOptions} options
 * @returns {TencentSignResult}
 */
export function tencentSign(
  payload: Payload,
  options: CapiOptions,
): TencentSignResult {
  const hostParams: HostParams = {
    host: options.host,
    path: options.path,
    protocol: options.protocol,
    baseHost: options.baseHost,
    ServiceType: options.ServiceType,
    Region: options.Region,
  };
  const url = getUrl(hostParams);
  const Host = getHost(hostParams);
  const nowTime = moment();
  const Timestamp = nowTime.unix();
  // const Nonce = Math.round(Math.random() * 65535)
  const date = nowTime.toISOString().slice(0, 10);
  const Algorithm = 'TC3-HMAC-SHA256';

  payload = dotQs.flatten(payload);

  // 1. create Canonical request string
  const HTTPRequestMethod = (options.method || 'POST').toUpperCase();
  const CanonicalURI = '/';
  const CanonicalQueryString = '';
  const CanonicalHeaders = `content-type:application/json\nhost:${Host}\n`;
  const SignedHeaders = 'content-type;host';
  const HashedRequestPayload = crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  const CanonicalRequest = `${HTTPRequestMethod}\n${CanonicalURI}\n${CanonicalQueryString}\n${CanonicalHeaders}\n${SignedHeaders}\n${HashedRequestPayload}`;

  // 2. create string to sign
  const CredentialScope = `${date}/${options.ServiceType}/tc3_request`;
  const HashedCanonicalRequest = crypto
    .createHash('sha256')
    .update(CanonicalRequest)
    .digest('hex');
  const StringToSign = `${Algorithm}\n${Timestamp}\n${CredentialScope}\n${HashedCanonicalRequest}`;

  // 3. calculate signature
  const SecretDate = sign(date, Buffer.from(`TC3${options.SecretKey}`, 'utf8'));
  const SecretService = sign(options.ServiceType, SecretDate);
  const SecretSigning = sign('tc3_request', SecretService);
  const Signature = crypto
    .createHmac('sha256', SecretSigning)
    .update(Buffer.from(StringToSign, 'utf8'))
    .digest('hex');

  // 4. create authorization
  const Authorization = `${Algorithm} Credential=${options.SecretId}/${CredentialScope}, SignedHeaders=${SignedHeaders}, Signature=${Signature}`;

  // log debug info
  if (options.debug) {
    logger('CanonicalRequest', CanonicalRequest);
    logger('StringToSign', StringToSign);
    logger('Signature', Signature);
    logger('Authorization', Authorization);
  }

  return {
    url,
    payload,
    Host,
    Authorization,
    Timestamp,
  };
}

/**
 * version1: generate tencent cloud sign result
 *
 * @param {Payload} payload
 * @param {CapiOptions} options
 * @returns {TencentSignResultV1}
 */
export function tencentSignV1(
  payload: Payload,
  options: CapiOptions,
): TencentSignResultV1 {
  const hostParams: HostParams = {
    host: options.host,
    path: options.path,
    protocol: options.protocol,
    baseHost: options.baseHost,
    ServiceType: options.ServiceType,
    Region: options.Region,
  };
  const url = getUrl(hostParams, true);
  const Host = getHost(hostParams, true);
  const nowTime = moment();
  const Timestamp = nowTime.unix();
  const Nonce = Math.round(Math.random() * 65535);

  payload.Region = options.Region;
  payload.Nonce = Nonce;
  payload.Timestamp = Timestamp;
  payload.SecretId = options.SecretId;
  payload.RequestClient = 'SDK_NODEJS_v0.0.1';

  if (options.SignatureMethod === 'sha256') {
    payload.SignatureMethod = 'HmacSHA256';
  }

  payload = dotQs.flatten(payload);

  const keys = Object.keys(payload).sort();
  const method = (options.method || 'POST').toUpperCase();

  let qstr = '';
  keys.forEach(function(key) {
    if (key === '') {
      return;
    }
    key = key.indexOf('_') ? key.replace(/_/g, '.') : key;
    let val = payload[key];
    if (method === 'POST' && val && val[0] === '@') {
      return;
    }
    if (
      val === undefined ||
      val === null ||
      (typeof val === 'number' && isNaN(val))
    ) {
      val = '';
    }
    qstr += `&${key}=${val}`;
  });

  qstr = qstr.slice(1);

  payload.Signature = sign(
    `${method}${Host}${options.path}?${qstr}`,
    Buffer.from(options.SecretKey, 'utf8'),
    options.SignatureMethod,
  ).toString('base64');

  return {
    url,
    method,
    signPath: qs.stringify(payload),
  };
}