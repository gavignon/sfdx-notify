import { flags, SfdxCommand } from '@salesforce/command';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { readFile, writeFile } from 'fs-extra';
import { HttpClient } from '../../../utils/HttpClient';
import * as path from 'path'; 

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('sfdx-notify', 'teams');

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
    output: flags.string({char: 'o', description: messages.getMessage('outputFlagDescription')}),
    outputformat: flags.string({char: 'f', description: messages.getMessage('outputFormatFlagDescription')}),
    separator: flags.string({char: 's', description: messages.getMessage('separatorFlagDescription')}),
    hosturl: flags.url({char: 'h', description: messages.getMessage('hostUrlFlagDescription')}),
    url: flags.url({char: 'u', description: messages.getMessage('urlFlagDescription')}),
    env: flags.string({char: 'e', description: messages.getMessage('envFlagDescription')})
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = false;

  // Comment this out if your command does not support a hub org username
  protected static supportsDevhubUsername = false;

  private async generateCSVFiles(failedTests, coverageData, failTestCsvPath, badCoverageFilePath, goodCoverageFilePath){
    let failCsvContent = '"Failed Test"' + this.flags.separator + '"Error"\n';
    let coverageHeader = '"Apex Class"' + this.flags.separator + '"Coverage (%)"\n';
    
    for(let test of failedTests){
      failCsvContent += '"' + test.FullName + '"' + this.flags.separator + '"' + test.Message + '\n' + test.StackTrace + '"\n';
    }

    await writeFile(failTestCsvPath, failCsvContent);

    let goodCoverageContent = coverageHeader;
    let badCoverageContent = coverageHeader;
    for(let coverage of coverageData){
      if(coverage.coveredPercent >= 85){
        goodCoverageContent += '"' + coverage.name + '"' + this.flags.separator + '"' + coverage.coveredPercent + '"\n';
      }else{
        badCoverageContent += '"' + coverage.name + '"' + this.flags.separator + '"' + coverage.coveredPercent + '"\n';
      }
    }
    await writeFile(goodCoverageFilePath, goodCoverageContent);
    await writeFile(badCoverageFilePath, badCoverageContent);
  }

  private formatMilliseconds(milliseconds){
    let seconds = Math.floor((milliseconds / 1000) % 60);
    let minutes = Math.floor((milliseconds / (1000 * 60)) % 60);
    let hours = Math.floor((milliseconds / (1000 * 60 * 60)) % 24);

    let finalString = '';

    if(hours > 0){
        finalString += hours + 'h';
    }
    if(minutes > 0){
        finalString += minutes + 'min';
    }
    if(seconds > 0){
        finalString += seconds + 's';
    }else{
        if(milliseconds > 0){
            finalString += milliseconds + 'ms';
        }
    }

    return finalString;
}

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
        if(this.flags.output === undefined){
          this.ux.warn('output parameter is empty, using "./output" instead.');
          this.flags.output = './output';
        }
        if(this.flags.separator === undefined){
          this.ux.warn('separator parameter is empty, using ";" instead.');
          this.flags.separator = ';';
        }
        if(this.flags.outputformat === undefined){
          this.ux.warn('outputformat parameter is empty, using "csv" instead.');
          this.flags.outputformat = 'csv';
        }

        if(this.flags.url === undefined || this.flags.hosturl === undefined){
            throw new Error(
            'One (or more) of the mandatory parameters is missing (url, hosturl)'
            );
        }

        let result = {};

        try{
          let fileContent = await readFile(this.flags.path);
          let testResult = JSON.parse(fileContent);

          let statusColor = testResult.result.summary.outcome == 'Passed' ? 'green' : 'red';
          let summaryTitle = 'Test Execution in ' + this.flags.env + ' - ' + testResult.result.summary.testStartTime;
          let summaryContent = '<strong>TestRunId: </strong>' + testResult.result.summary.testRunId + ' (Execution Time: ' + this.formatMilliseconds(testResult.result.summary.testExecutionTime.replace(' ms','')) + ')'
                              + '\n\n' + '<strong>Status: </strong><span style="color:' + statusColor + ';">' + testResult.result.summary.outcome + '</span>'
                              + '\n\n' + '<strong>Coverage: </strong>' + testResult.result.summary.testRunCoverage + ' (Test Run Coverage) ' + testResult.result.summary.orgWideCoverage + ' (Org Wide Coverage)'
                              + '\n\n' + '<strong>Tests Ran: </strong>' + testResult.result.summary.testsRan
                              + '\n\n' + '<strong>Tests Passed: </strong>' + testResult.result.summary.passing + ' (' + testResult.result.summary.passRate + ')'
                              + '\n\n' + '<strong>Tests Failed: </strong>' + testResult.result.summary.failing + ' (' + testResult.result.summary.failRate + ')';

                              let failedTests = new Array();
          let coverageApexClasses = testResult.result.coverage.coverage;

          for(let test of testResult.result.tests){
            if(test.Outcome == 'Fail' || test.Outcome == 'CompileFail'){
              failedTests.push(test);
            }
          }

          // Create files
          this.ux.startSpinner('Generate coverage files');

          // Sort
          failedTests.sort((obj1, obj2) => {
            if (obj1.FullName > obj2.FullName) {
                return 1;
            }if (obj1.FullName < obj2.FullName) {
                return -1;
            }
            return 0;
          });
          coverageApexClasses.sort((obj1, obj2) => {
            if (obj1.FullName > obj2.FullName) {
                return 1;
            }if (obj1.FullName < obj2.FullName) {
                return -1;
            }
            return 0;
          });

          let failTestFilePath = path.join(this.flags.output, 'failedTest.' + this.flags.outputformat);
          let goodCoverageFilePath = path.join(this.flags.output, 'goodCoverage.' + this.flags.outputformat);
          let badCoverageFilePath = path.join(this.flags.output, 'badCoverage.' + this.flags.outputformat);

          switch(this.flags.outputformat) { 
            case 'html': { 
              // TODO: HTML Rendering
              // await this.generateCSVFiles(failedTests, coverageApexClasses, failTestCsvPath, goodCoverageFilePath, badCoverageFilePath);
              break; 
            } 
            default: { 
              await this.generateCSVFiles(failedTests, coverageApexClasses, failTestFilePath, goodCoverageFilePath, badCoverageFilePath);
              break; 
            } 
          } 
          this.ux.stopSpinner('Done!');

          // Generate URLs
          let failedTestsUrl = this.flags.storageurl.toString().concat(failTestFilePath);
          let coverageToReviewUrl = this.flags.storageurl.toString().concat(badCoverageFilePath);
          let goodCoverageUrl = this.flags.storageurl.toString().concat(goodCoverageFilePath);

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
              }],
              "potentialAction": [
                {
                  "@type": "OpenUri",
                  "name": "Failed Tests",
                  "targets": [{
                      "os": "default",
                      "uri": failedTestsUrl
                  }]
                }, {
                      "@type": "OpenUri",
                      "name": "Coverage to review",
                      "targets": [{
                          "os": "default",
                          "uri": coverageToReviewUrl
                      }]
                },
                {
                    "@type": "OpenUri",
                    "name": "Good Coverage (>= 85%)",
                    "targets": [{
                        "os": "default",
                        "uri": goodCoverageUrl
                    }]
                }
              ]
          };

          result = data;
          await writeFile('request.json', JSON.stringify(data));

          this.ux.startSpinner('Notify deployment status on Microsoft Teams');
          await HttpClient.sendRequest(this.flags.url.toString(), data);
          this.ux.stopSpinner('Done!');
        }catch(error){
          throw error;
        }

        // Return an object to be displayed with --json
        return result;
    }
}
