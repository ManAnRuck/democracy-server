import { CronJob } from 'cron';

import sendNotifications from './../../scripts/sendNotifications';
import importDeputyProfiles from './../../importer/importDeputyProfiles';
import importNamedPolls from './../../importer/importNamedPolls';

const cronJobs = () => [
  new CronJob('0 8 * * *', sendNotifications, null, true, 'Europe/Berlin'),
  new CronJob('45 19 * * *', sendNotifications, null, true, 'Europe/Berlin'),
  new CronJob('*/15 * * * *', importDeputyProfiles, null, true, 'Europe/Berlin', null, true),
  new CronJob('*/15 * * * *', importNamedPolls, null, true, 'Europe/Berlin', null, true),
];

module.exports = cronJobs;
