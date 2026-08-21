export const Expo: any = jest.fn().mockImplementation(() => ({
  chunkPushNotifications: (msgs: any[]) => [msgs],
  sendPushNotificationsAsync: () => Promise.resolve([]),
  isExpoPushToken: (t: string) => t.startsWith('ExponentPushToken'),
}));

export const ExpoPushMessage = (m: any) => m;
export const ExpoPushTicket = (t: any) => t;
export default { Expo, ExpoPushMessage, ExpoPushTicket };
