import _ from 'lodash';
import moment from 'moment';

// Definitions
import { PROCEDURE as PROCEDURE_DEFINITIONS } from '@democracy-deutschland/bundestag.io-definitions';

// GraphQL
import { detailedDiff } from 'deep-object-diff';
import createClient from '../graphql/client';
import getProcedureUpdates from '../graphql/queries/getProcedureUpdates';
import { getCron, setCronError, setCronSuccess } from '../services/cronJobs/tools';

// Models
import Procedure from '../models/Procedure';
import PushNotifiaction from '../models/PushNotifiaction';

// Queries
import { procedureUpdate } from '../services/notifications';
import { convertPartyName } from './tools';

/* const deputiesNumber = {
  8: 518,
  9: 519,
  10: 520,
  11: 663,
  12: 662,
  13: 672,
  14: 665,
  15: 601,
  16: 611,
  17: 620,
  18: 630,
  19: 709,
}; */

const sendProcedurePushs = async (newBIoProcedure, newDoc, oldProcedure) => {
  /**
   * PUSH NOTIFICATIONS
   */
  // New Procedures
  if (!oldProcedure) {
    Log.push(
      JSON.stringify({
        type: 'new Procedure',
        ids: newBIoProcedure.procedureId,
      }),
    );
    PushNotifiaction.create({
      procedureId: newBIoProcedure.procedureId,
      type: 'new',
    });
    // newPreperation({ procedureId: newBIoProcedure.procedureId });
  } else {
    // Updated Procedures
    const diffs = detailedDiff(newDoc.toObject(), oldProcedure.toObject());
    const updatedValues = _.compact(
      _.map(diffs.updated, (value, key) => {
        switch (key) {
          case 'currentStatus':
          case 'importantDocuments':
          case 'voteResults':
            return key;

          case 'updatedAt':
          case 'bioUpdateAt':
            return null;

          default:
            return null;
        }
      }),
    );
    if (updatedValues.length > 0) {
      Log.import(
        JSON.stringify({
          type: 'updated Procedure',
          ids: newBIoProcedure.procedureId,
          diffs,
        }),
      );
      PushNotifiaction.create({
        procedureId: newBIoProcedure.procedureId,
        type: 'update',
        updatedValues,
      });
      procedureUpdate({ procedureId: newBIoProcedure.procedureId });
    }
    if (
      (newBIoProcedure.currentStatus === PROCEDURE_DEFINITIONS.STATUS.BESCHLUSSEMPFEHLUNG &&
        oldProcedure.currentStatus !== PROCEDURE_DEFINITIONS.STATUS.BESCHLUSSEMPFEHLUNG &&
        !(
          oldProcedure.currentStatus === PROCEDURE_DEFINITIONS.STATUS.UEBERWIESEN &&
          newBIoProcedure.voteDate > new Date()
        )) ||
      (newBIoProcedure.currentStatus === PROCEDURE_DEFINITIONS.STATUS.UEBERWIESEN &&
        newBIoProcedure.voteDate > new Date() &&
        !oldProcedure.voteDate)
    ) {
      // moved to Vote Procedures
      Log.import(
        JSON.stringify({
          type: 'new Vote',
          ids: newBIoProcedure.procedureId,
        }),
      );
      PushNotifiaction.create({
        procedureId: newBIoProcedure.procedureId,
        type: 'newVote',
      });
      // newVote({ procedureId: newBIoProcedure.procedureId });
    }
  }
};

const importProcedures = async (bIoProcedure, { push = false }) => {
  if (bIoProcedure && bIoProcedure.history) {
    const [lastHistory] = bIoProcedure.history.slice(-1);
    bIoProcedure.lastUpdateDate = lastHistory.date; // eslint-disable-line no-param-reassign
    bIoProcedure.submissionDate = bIoProcedure.history[0].date; // eslint-disable-line no-param-reassign
  }

  // check vote results
  let voteResults = {
    yes: null,
    no: null,
    abstination: null,
    notVoted: null,
  };
  if (
    bIoProcedure.customData &&
    bIoProcedure.customData.voteResults &&
    (bIoProcedure.customData.voteResults.yes ||
      bIoProcedure.customData.voteResults.abstination ||
      bIoProcedure.customData.voteResults.no)
  ) {
    voteResults = {
      yes: bIoProcedure.customData.voteResults.yes,
      abstination: bIoProcedure.customData.voteResults.abstination,
      no: bIoProcedure.customData.voteResults.no,
      notVoted: bIoProcedure.customData.voteResults.notVoted,
      decisionText: bIoProcedure.customData.voteResults.decisionText,
      namedVote: bIoProcedure.namedVote,
    };

    if (bIoProcedure.customData.voteResults.partyVotes) {
      voteResults.partyVotes = bIoProcedure.customData.voteResults.partyVotes.map(
        ({ party, ...rest }) => ({
          ...rest,
          party: convertPartyName(party),
        }),
      );

      // toggle votingData (Yes & No) if needed
      if (
        bIoProcedure.customData.voteResults.votingDocument === 'recommendedDecision' &&
        bIoProcedure.customData.voteResults.votingRecommendation === false
      ) {
        voteResults = {
          ...voteResults,
          yes: voteResults.no,
          no: voteResults.yes,
          partyVotes: voteResults.partyVotes.map(({ main, deviants, ...rest }) => {
            let mainDecision = main;
            if (main !== 'ABSTINATION') {
              mainDecision = main === 'YES' ? 'NO' : 'YES';
            }
            return {
              ...rest,
              main: mainDecision,
              deviants: {
                ...deviants,
                yes: deviants.no,
                no: deviants.yes,
              },
            };
          }),
        };
      }
    }
  }
  bIoProcedure.voteResults = voteResults; // eslint-disable-line no-param-reassign

  // Extract Session info
  if (bIoProcedure.sessions) {
    // This assumes that the last entry will always be the vote
    const lastSession = bIoProcedure.sessions.pop();
    if (lastSession && lastSession.session.top.topic.isVote) {
      bIoProcedure.voteWeek = lastSession.thisWeek; // eslint-disable-line no-param-reassign
      bIoProcedure.voteYear = lastSession.thisYear; // eslint-disable-line no-param-reassign
      bIoProcedure.sessionTOPHeading = lastSession.session.top.heading; // eslint-disable-line no-param-reassign
    }
  }
  // Set CalendarWeek & Year even if no sessions where found
  if (bIoProcedure.voteDate && (!bIoProcedure.voteWeek || !bIoProcedure.voteYear)) {
    bIoProcedure.voteWeek = moment(bIoProcedure.voteDate).format('W'); // eslint-disable-line no-param-reassign
    bIoProcedure.voteYear = moment(bIoProcedure.voteDate).year(); // eslint-disable-line no-param-reassign
  }

  const oldProcedure = await Procedure.findOne({
    procedureId: bIoProcedure.procedureId,
  });

  return Procedure.findOneAndUpdate(
    { procedureId: bIoProcedure.procedureId },
    _(bIoProcedure)
      .omitBy(x => _.isUndefined(x))
      .value(),
    {
      upsert: true,
      new: true,
    },
  ).then(newDoc => {
    if (push) {
      sendProcedurePushs(bIoProcedure, newDoc, oldProcedure);
    }
  });
};

export default async () => {
  Log.info('Start Importing Procedures');
  const name = 'importProcedures';
  const cron = await getCron({ name });
  // Last SuccessStartDate
  const since = new Date(cron.lastSuccessStartDate);
  // New SuccessStartDate
  const startDate = new Date();

  // Query Bundestag.io
  try {
    const client = createClient();
    const limit = 50;
    let offset = 0;
    const associated = true;
    let done = false;
    while (!done) {
      // fetch
      const {
        data: {
          procedureUpdates: { procedures },
        },
      } =
        // eslint-disable-next-line no-await-in-loop
        await client.query({
          query: getProcedureUpdates,
          variables: { since, limit, offset, associated },
        });

      // handle results
      procedures.map(data => {
        if (
          data.period === 19 &&
          (data.type === PROCEDURE_DEFINITIONS.TYPE.GESETZGEBUNG ||
            data.type === PROCEDURE_DEFINITIONS.TYPE.ANTRAG)
        ) {
          importProcedures(data, { push: true });
        }
        return null;
      });

      // continue?
      if (procedures.length < limit) {
        done = true;
      }
      offset += limit;
    }
    // Update Cron - Success
    await setCronSuccess({ name, successStartDate: startDate });
  } catch (error) {
    // If address is not reachable the query will throw
    // Update Cron - Error
    await setCronError({ name });
    Log.error(error);
  }

  Log.info('Finish Importing Procedures');
};
