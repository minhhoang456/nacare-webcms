import bwipjs from 'bwip-js';
import qrcode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import ono from '@jsdevtools/ono';
import Conf from '@src/services/conf';
import { RawAxiosRequestConfig } from 'axios';
import request from './request';
import { ZodError } from 'zod';

const password = 'supersecretpassword';
/**
 *
 * @param password check password stregth
 * @returns
 */
function checkPasswordStrength(password: string) {
  const strongRegex = new RegExp(
    '^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*])(?=.{8,})'
  );
  return strongRegex.test(password);
}

function checkUserNameStrength(username: string) {
  const strongRegex = new RegExp('^[a-zA-Z0-9]+$');
  return strongRegex.test(username);
}

function checkPhone(phone: string) {
  const strongReg = /((0[3|5|7|8|9])+([0-9]{8})\b)/g;
  return strongReg.test(phone);
}

function removeAccents(
  str: string,
  fomartCase: 'uppercase' | 'lowercase' | 'no'
) {
  str = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
  switch (fomartCase) {
    case 'uppercase': {
      return str.toUpperCase();
    }
    case 'lowercase': {
      return str.toLowerCase();
    }
    default: {
      return str;
    }
  }
}

function removeAccentsAndReplaceSpaces(
  str: string,
  fomartCase: 'uppercase' | 'lowercase' | 'no'
) {
  str = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/\s+/g, '_');
  switch (fomartCase) {
    case 'uppercase': {
      return str.toUpperCase();
    }
    case 'lowercase': {
      return str.toLowerCase();
    }
    default: {
      return str;
    }
  }
}

function removeAccentsAndSpaces(
  str: string,
  fomartCase: 'uppercase' | 'lowercase' | 'no'
) {
  str = str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '');
  switch (fomartCase) {
    case 'uppercase': {
      return str.toUpperCase();
    }
    case 'lowercase': {
      return str.toLowerCase();
    }
    default: {
      return str;
    }
  }
}

function randomCode(inputs: {
  size: number;
  stringOnly?: boolean;
  numberOnly?: boolean;
}) {
  let text = '';
  let possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  if (inputs.stringOnly) {
    possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  }
  if (inputs.numberOnly) {
    possible = '0123456789';
  }
  for (let i = 0; i < inputs.size; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}

function generateBarcodeSVG(text: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const svg = bwipjs.toSVG({
        bcid: 'code128', // Barcode type
        text, // Text to encode
        height: 12, // Bar height, in millimeters
        includetext: false, // Show human-readable text
        textxalign: 'center', // Always good to set this
      });
      resolve(svg);
    } catch (error) {
      reject(error);
    }
  });
}

function generateQRCodeSVG(
  text: string,
  options?: qrcode.QRCodeRenderersOptions
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    try {
      const svgString = qrcode.toString(text, {
        type: 'svg',
        ...options,
      });
      resolve(svgString);
    } catch (err) {
      reject(err);
    }
  });
}

function encrypt(text: string): string {
  // First XOR the text with the key for basic scrambling
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const charCode =
      text.charCodeAt(i) ^ password.charCodeAt(i % password.length);
    result += String.fromCharCode(charCode);
  }
  return Buffer.from(result).toString('base64');
}

function decrypt(encryptedText: string): string {
  const decoded = Buffer.from(encryptedText, 'base64').toString();
  let result = '';
  for (let i = 0; i < decoded.length; i++) {
    const charCode =
      decoded.charCodeAt(i) ^ password.charCodeAt(i % password.length);
    result += String.fromCharCode(charCode);
  }
  return result;
}

function generateBasicAuthHeader(username: string, password: string): string {
  const credentials = `${username}:${password}`;
  const base64Credentials = Buffer.from(credentials).toString('base64');
  return `Basic ${base64Credentials}`;
}

async function checkBlackList(msisdn: string) {
  try {
    if (!msisdn) throw ono('invalid_params');
    const endpoint: string = Conf.get(
      'BLACKLIST_URL_CHECK',
      'http://125.235.38.229:8080/game/game2021-api/v1/private/is-black-list'
    );
    const clientId = Conf.get('BLACKLIST_CLIENT_ID', 'voucher');
    const clientSecret: string = Conf.get('BLACKLIST_CLIENT_SECRET', '123123');
    const payload = {
      msisdn: msisdn,
      eventCode: 'VOUCHER_M1',
    };
    const options: RawAxiosRequestConfig = {
      method: 'POST',
      url: `${endpoint}`,
      headers: {
        'content-type': 'application/json',
        'Client-Id': clientId,
        'Client-Secret': clientSecret,
      },
      data: JSON.stringify(payload),
      timeout: 3000,
    };
    const rs = await request(options);
    if (rs.status && rs.status.code == '00') {
      return rs.data;
    }
  } catch (err) {
    console.log('🚀 ~ checkBlackList ~ err:', err);
    return true;
  }
}

function generateShortUnique(): string {
  const hexStringUndecorated = uuidv4().replace(/-/g, '');
  const base64String = Buffer.from(hexStringUndecorated, 'hex').toString(
    'base64'
  );
  console.log('base64:', base64String);

  return base64String;
}
function sortBy(params: { data: any[]; keepTop: any[]; sortBy: string }) {
  // eslint-disable-next-line prefer-const
  let { data, keepTop, sortBy } = params;
  const top = [];
  for (let i = 0; i < keepTop.length; i++) {
    const index = data.findIndex((m: any) => m[sortBy] === keepTop[i]);
    if (index > -1) {
      top.push(data[index]);
      data.splice(index, 1);
    }
  }
  // data = data.sort(function (a, b) {
  //   return a[sortBy].toLowerCase().localeCompare(b[sortBy].toLowerCase())
  // })
  const sorted = top.concat(data);
  return sorted;
}

function generateMessageErrorZod(error: ZodError) {
  const errors = error.issues.map((err) => {
    const field = err.path.join('.');
    let message = err.message;
    return {
      field,
      message,
    };
  });
  return errors;
}

function stringToUint8Array(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hmacSHA256(key: string, message: string): Promise<string> {
  try {
    const crypto = require('crypto');
    // Convert key and message to Uint8Array
    const keyData = stringToUint8Array(key);
    const messageData = stringToUint8Array(message);

    // Import the key for HMAC
    const importedKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      {
        name: 'HMAC',
        hash: 'SHA-256',
      },
      false,
      ['sign']
    );

    // Generate HMAC
    const signature = await crypto.subtle.sign(
      {
        name: 'HMAC',
        hash: 'SHA-256',
      },
      importedKey,
      messageData
    );

    // Convert to hex string
    return bufferToHex(signature);
  } catch (error) {
    console.error('HMAC SHA256 generation failed:', error);
    throw error;
  }
}

async function verifyHmacSHA256(
  key: string,
  message: string,
  signature: string
): Promise<boolean> {
  try {
    const computedSignature = await hmacSHA256(key, message);
    return computedSignature === signature;
  } catch (error) {
    console.error('HMAC verification failed:', error);
    return false;
  }
}

export default {
  checkPasswordStrength,
  checkPhone,
  removeAccents,
  removeAccentsAndReplaceSpaces,
  removeAccentsAndSpaces,
  randomCode,
  generateBarcodeSVG,
  generateQRCodeSVG,
  encrypt,
  decrypt,
  checkUserNameStrength,
  generateBasicAuthHeader,
  checkBlackList,
  generateShortUnique,
  sortBy,
  generateMessageErrorZod,
  hmacSHA256,
  verifyHmacSHA256,
};
