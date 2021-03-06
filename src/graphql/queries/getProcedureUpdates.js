import gql from 'graphql-tag';

export default gql`
  query procedureUpdates($since: Date!, $limit: Int, $offset: Int) {
    procedureUpdates(since: $since, limit: $limit, offset: $offset) {
      beforeCount
      afterCount
      newCount
      changedCount
      procedures {
        title
        procedureId
        type
        period
        currentStatus
        currentStatusHistory
        abstract
        tags
        subjectGroups
        bioUpdateAt
        history {
          assignment
          initiator
          decision {
            tenor
            type
            comment
          }
          date
        }
        importantDocuments {
          editor
          type
          url
          number
        }
        namedVote
        voteDate
        voteEnd
        customData {
          voteResults {
            yes
            no
            abstination
            notVoted
            decisionText
            votingDocument
            votingRecommendation
            partyVotes {
              party
              main
              deviants {
                yes
                no
                abstination
                notVoted
              }
            }
          }
        }
        sessions {
          thisYear
          thisWeek
          session {
            top {
              heading
              topic {
                isVote
              }
            }
          }
        }
      }
    }
  }
`;
