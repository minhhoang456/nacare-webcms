import inquirer from 'inquirer'
import fs from 'fs'
import path from 'path'

inquirer
  .prompt([
    {
      type: 'list',
      name: 'type',
      message: 'Select type for generate:',
      choices: [
        { name: 'controller', checked: true },
        { name: 'service', checked: true }
      ]
    },
    {
      type: 'input',
      name: 'name',
      message: 'Enter the name of the file:'
    }
  ])
  .then((answers) => {
    const { name, type } = answers
    switch (type) {
      // Service
      case 'service': {
        const serviceName = `${name}.service`
        const pathOfService = path.join(
          __dirname,
          `src/services/${serviceName}.ts`
        )
        fs.access(pathOfService, (err) => {
          if (!err) {
            throw new Error(`File ${serviceName}.ts already exists!`)
          }
          const pathTemplate = path.resolve(__dirname, 'template/service.ts')
          const template = fs.readFileSync(pathTemplate, 'utf8')
          const content = template.replace(/\$Template/g, name)

          fs.writeFile(pathOfService, content, (err) => {
            if (err) throw err
            console.log(`Service ${serviceName}.ts has been generated!`)
            const pathOfIndexService = path.resolve(
              __dirname,
              `src/services/index.ts`
            )
            fs.appendFile(
              pathOfIndexService,
              `export * from "./${serviceName}"\n`,
              (err) => {
                if (err) throw err
                console.log(`Appended ${serviceName} to ${pathOfIndexService}`)
              }
            )
          })
        })
        break
      }
      // Controller
      case 'controller': {
        const subfolders = name.split('/').slice(0, -1) // Get all but the last element
        let currentPath = 'src/controller'
        subfolders.forEach((subfolder: any) => {
          currentPath = path.join(currentPath, subfolder)
          if (!fs.existsSync(currentPath)) {
            fs.mkdirSync(currentPath)
          }
        })
        const filePath = path.join(currentPath, `${name.split('/').pop()}.ts`)
        if (fs.existsSync(filePath)) {
          throw new Error(`File ${filePath} already exists!`)
        }
        const template = fs.readFileSync('template/controller.ts', 'utf8')
        const content = template.replace(
          /\$action/g,
          name.split('/').pop()
          // .replace(/-([a-z])/g, (_: any, char: any) => char.toUpperCase())
        )
        fs.writeFile(filePath, content, (err) => {
          if (err) throw err
          console.log(`File ${filePath} has been generated!`)
        })
        break
      }
    }
  })
