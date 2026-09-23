@{
    ServiceName = 'LabframeManager'
    DisplayName = 'Labframe Manager'
    Description = 'Independent Labframe telemetry viewer and dependency observations.'
    WrapperFileName = 'LabframeManager.exe'
    WrapperXmlFileName = 'LabframeManager.xml'
    ReleaseProduct = 'labframe-manager'
    ReleaseExecutable = 'labframe-manager.exe'
    RequiredReleasePaths = @(
        'resources/labframe-manager/web/index.html',
        'resources/labframe-manager/resources/onlyoffice-status.ps1',
        'resources/labframe-manager/resources/login.html',
        'resources/labframe-manager/resources/login.css',
        'resources/labframe-manager/resources/manager-mark.svg'
    )
    ConfigurationReferenceNames = @('queryConfigFile')
}
