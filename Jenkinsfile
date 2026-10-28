pipeline {
    agent {
        label '!windows'
    }
    environment {
        DEPLOY_VERSION =  sh(script: 'date +%s', returnStdout: true).trim()
       
    }
    stages {
      stage('set ENV'){
        steps {
          script {
           env.BRANCH_NAME = "main"
           env.PROJECT_NAME="vds-prod"
           sh 'sudo sh /root/getoken.sh'
           configFileProvider(
                [configFile(fileId: 'defaut_lifecycle_ecr', variable: 'policy_tmp')]) {
                      sh "cp -v ${env.policy_tmp} ecr_policy.json"
    			}
          }
        }
      }
        stage('build and push image ') {
            steps {
                script {
                       ///push on aws

                       sh 'echo "start build image for aws ${BRANCH_NAME} => tag:${TAG}"'
                       sh 'git checkout tags/${TAG}'
                       sh 'sudo aws ecr create-repository --repository-name ${PROJECT_NAME} --region ap-southeast-1  > /dev/null 2>&1 || true'
                       sh 'sudo aws ecr put-lifecycle-policy --repository-name ${PROJECT_NAME} --lifecycle-policy-text file://ecr_policy.json  > /dev/null 2>&1 || true'
                       sh """
                       sudo docker build -t 621726795094.dkr.ecr.ap-southeast-1.amazonaws.com/${PROJECT_NAME}:${BRANCH_NAME}-${DEPLOY_VERSION} .
                       sudo docker push 621726795094.dkr.ecr.ap-southeast-1.amazonaws.com/${PROJECT_NAME}:${BRANCH_NAME}-${DEPLOY_VERSION}
                       sleep 3
                       sudo docker rmi 621726795094.dkr.ecr.ap-southeast-1.amazonaws.com/${PROJECT_NAME}:${BRANCH_NAME}-${DEPLOY_VERSION}
                       """
                 }
            }
        }
        stage('Get info git') {
            steps {
                script {
              def author_name = sh(script: "git log -n 1 ${env.GIT_COMMIT} --format=%aN", returnStdout: true).trim()
              def committer_name = sh(script: "git log -n 1 ${env.GIT_COMMIT} --format=%cN", returnStdout: true).trim()
              def commit_message = sh(script: "git log -1 --format=%B ${GIT_COMMIT}", returnStdout: true).trim()
              env.COMMIT_NAME  = committer_name
              env.COMIT_MESSAGE  = commit_message
              env.AUTHOR_NAME  = author_name
                }
            }
        }
        stage('deploy') {
            steps {
                script {
                 env.NAME_SPACE = 'default'
                 sh """cat "aws.deploy.${BRANCH_NAME}.yaml" | sed "s+{{IMAGE}}+621726795094.dkr.ecr.ap-southeast-1.amazonaws.com/${PROJECT_NAME}:${BRANCH_NAME}-${DEPLOY_VERSION}+g" | sudo kubectl --context=arn:aws:eks:ap-southeast-1:621726795094:cluster/vds-clt apply -f - -n ${NAME_SPACE}"""

                }
            }
        }
    }
    post {
       success {
         sh 'curl -s -X POST https://api.telegram.org/bot1933840335:AAETvo_BwVykDzddqrfV95hZhlU9sk53lWo/sendMessage -d chat_id=-552451392 -d parse_mode="html" -d text="✅ <b>${PROJECT_NAME} ${BRANCH_NAME}</b> \n<b>Status:</b> Triển khai thành công \n<b>Commit:</b> ${COMIT_MESSAGE}\n<b>Author:</b> ${AUTHOR_NAME}\n<b>Committer:</b> ${COMMIT_NAME}"'
        }
       failure {
           sh 'curl -s -X POST https://api.telegram.org/bot1933840335:AAETvo_BwVykDzddqrfV95hZhlU9sk53lWo/sendMessage -d chat_id=-552451392 -d parse_mode="html" -d text="❌ <b>${PROJECT_NAME} ${BRANCH_NAME}</b> \n<b>Status:</b> Triển khai thất bại \n<b>Commit:</b> ${COMIT_MESSAGE}\n<b>Author:</b> ${AUTHOR_NAME}\n<b>Committer:</b> ${COMMIT_NAME}"'

        }
    }
}
