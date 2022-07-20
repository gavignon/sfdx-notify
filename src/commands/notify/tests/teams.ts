import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { readFile } from 'fs/promises';
import { HttpClient } from '../../../utils/HttpClient';

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-notify', 'teams');

interface Item {
  number?: string,
  name?: string,
  type?: string
}

interface Fact {
  name?: string,
  value?: string
}

export default class Teams extends SfdxCommand {

  public static description = messages.getMessage('commandDescription');

  public static examples = [
  `$ sfdx notify:teams --from 5.0 --to HEAD -u https://outlook.office.com/webhook/WEBHOOK_URL -e UAT -b $BITBUCKET_BRANCH
  Notify deployment status on Microsoft Teams... Done!
  `
  ];

  public static args = [{name: 'Notify'}];

  protected static flagsConfig = {
    path: flags.directory({char: 'p', description: messages.getMessage('pathFlagDescription')}),
    url: flags.url({char: 'u', description: messages.getMessage('urlFlagDescription')}),
    env: flags.string({char: 'e', description: messages.getMessage('envFlagDescription')})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

    public async run(): Promise<AnyJson> {
        if(this.flags.path === undefined){
            this.ux.warn('Test Result JSON file path parameter is empty, using "./TestResult.json" instead.');
            this.flags.path = './TestResult.json';
        }
        if(this.flags.env === undefined){
            this.ux.warn('Env parameter is empty, using "current environment" instead.');
            this.flags.env = 'current environment';
        }
        if(this.flags.casesensitive === undefined){
            this.flags.casesensitive = false;
        }

        if(this.flags.url === undefined){
            throw new Error(
            'One (or more) of the mandatory parameters is missing (url)'
            );
        }

        let fileContent = await readFile(this.flags.path);
        let testResult = JSON.parse(fileContent);

        let statusColor = testResult.result.summary.outcome == 'Passed' ? 'green' : 'red';
        let summaryTitle = 'Test Execution in ' + this.flags.env + ' - ' + testResult.result.summary.testStartTime;
        let summaryContent = '<strong>TestRunId: </strong>' + testResult.result.summary.testRunId + ' (Execution Time: ' + testResult.result.summary.testExecutionTime + ')'
                            + '\n\n' + '<strong>Status: </strong><span style="color:' + statusColor + ';">' + testResult.result.summary.outcome + '</span>'
                            + '\n\n' + '<strong>Coverage: </strong>' + testResult.result.summary.testRunCoverage + ' (Test Run Coverage) ' + testResult.result.summary.orgWideCoverage + ' (Org Wide Coverage)'
                            + '\n\n' + '<strong>Tests Ran: </strong>' + testResult.result.summary.testsRan
                            + '\n\n' + '<strong>Tests Passed: </strong>' + testResult.result.summary.passing + ' (' + testResult.result.summary.passRate + ')'
                            + '\n\n' + '<strong>Tests Failed: </strong>' + testResult.result.summary.failing + ' (' + testResult.result.summary.failRate + ')';

        let facts = new Array();

        for(let coverage of testResult.result.coverage.coverage){
            let fact: Fact = {};
            fact.name = coverage.name;
            fact.value = coverage.coveredPercent + '%';
            facts.push(fact);
        }

        facts.sort((obj1, obj2) => {
          if (obj1.name > obj2.name) {
              return 1;
          }
          if (obj1.name < obj2.name) {
              return -1;
          }
          return 0;
        });

        let data = 
        {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": "0076D7",
            "summary": "Test",
            "sections": [{
                "activityTitle": summaryTitle,
                "activitySubtitle": summaryContent,
                "markdown": true
            },
            {
                "activityTitle": "Coverage",
                "activitySubtitle": '',
                "facts": facts,
                "markdown": true
            }]
        };

        this.ux.startSpinner('Notify deployment status on Microsoft Teams');
        let requestResult = await HttpClient.sendRequest(this.flags.url.toString(), data);
        this.ux.stopSpinner('Done!');

        // Return an object to be displayed with --json
        return data;
    }
}