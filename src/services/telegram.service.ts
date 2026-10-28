import TelegramBot from 'node-telegram-bot-api';
import Conf from '@src/services/conf';

const tokenVdsCheck = '7418356309:AAHd8uncRpUyp_p2116t9J5nrDDsZLfQRmU';
const botVdsCheck = new TelegramBot(tokenVdsCheck, { polling: false });

const token =
  process.env.TELEGRAM_BOT_TOKEN ||
  '7013973704:AAFE9NnNoLS-mNkwTF3RGxe_Xx0qLuAE4dM';

// Create a new instance of TelegramBot with your token
const bot = new TelegramBot(token, { polling: false });

// Replace 'YOUR_CHAT_ID' with your actual chat ID
const chatId = process.env.TELEGRAM_CHAT_ID || '-4503457384';

// Function to send a message

export const telegramService = {
  sendTelegramMessage: (message: any) => {
    try {
      bot
        .sendMessage(chatId, message)
        .then(() => {
          /** */
        })
        .catch((_error) => {
          /** */
        });
    } catch (error) {
      /** */
    }
  },

  sendAlertVoucherSync: (message: any) => {
    try {
      const chatId = Conf.get(
        'TELEGRAM_CHAT_ID_ALERT_VOUCHER_SYNC',
        '-4503457384'
      );
      bot
        .sendMessage(chatId, message)
        .then(() => {
          /** */
        })
        .catch((_error) => {
          /** */
        });
    } catch (error) {
      /** */
    }
  },

  sendAlertTechnical: (message: any) => {
    try {
      const chatId = -4503457384;
      botVdsCheck
        .sendMessage(chatId, message)
        .then(() => {
          /** */
        })
        .catch((_error) => {
          /** */
        });
    } catch (error) {
      /** */
    }
  },

  // bootstrap: () => {
  //   setTimeout(async () => {
  //     telegramService.sendAlertTechnical('AAAAAAAAAAAAA')
  //   }, 1000)
  // }
};
export default telegramService;
